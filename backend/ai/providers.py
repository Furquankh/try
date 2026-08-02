"""LLM provider abstraction for the IQAC Personal AI Agent.

All model calls in the AI subsystem go through this module. Concrete providers
(Gemini, OpenAI, Anthropic, Ollama, OpenRouter) implement the same async
streaming + tool-calling contract, so the rest of the codebase never has to
know which vendor is active.

Selection is driven by env vars (see `/app/backend/.env`):

* ``AI_PROVIDER`` — one of ``gemini`` | ``openai`` | ``anthropic`` |
  ``ollama`` | ``openrouter`` (default: ``gemini``)
* ``AI_MODEL`` — model id native to the selected provider
  (default: ``gemini-2.0-flash``)
* provider-specific keys: ``GEMINI_API_KEY``, ``OPENAI_API_KEY``,
  ``ANTHROPIC_API_KEY``, ``OPENROUTER_API_KEY``, ``OLLAMA_BASE_URL``.

Usage
-----
    from ai.providers import get_provider, ChatMessage, ToolSpec

    provider = get_provider()
    async for event in provider.stream_chat(
        messages=[ChatMessage(role="user", content="Hello")],
        tools=[...],
    ):
        if event.type == "text":
            print(event.text, end="", flush=True)
        elif event.type == "tool_call":
            ...

The streaming contract is deliberately narrow (see ``StreamEvent``) so that
the routes layer can forward the same event shape over SSE / WebSocket to the
browser without any per-provider glue.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Literal, Optional

logger = logging.getLogger("iqac.ai.providers")

# ---------------------------------------------------------------------------
# Shared data types
# ---------------------------------------------------------------------------

Role = Literal["system", "user", "assistant", "tool"]


@dataclass
class ChatMessage:
    """A single conversation turn passed to the LLM.

    ``tool_call_id`` and ``name`` are only meaningful for ``role='tool'``
    (the response we send back after executing a tool) and for
    ``role='assistant'`` messages that themselves invoked tools (echoed back
    on the next turn so the model has full context).
    """
    role: Role
    content: str = ""
    tool_call_id: Optional[str] = None
    name: Optional[str] = None
    tool_calls: List["ToolCall"] = field(default_factory=list)


@dataclass
class ToolSpec:
    """JSON-schema description of a callable tool exposed to the model."""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema object (``type=object``)


@dataclass
class ToolCall:
    """A tool invocation emitted by the model during a turn."""
    id: str
    name: str
    arguments: Dict[str, Any]
    thought_signature: Optional[str] = None  # base64 — Gemini requires this echoed back on replay


@dataclass
class StreamEvent:
    """Discrete event yielded by a provider's ``stream_chat`` iterator.

    Consumers should switch on ``type``:

    * ``text``      — incremental assistant token chunk (append to buffer).
    * ``tool_call`` — model has decided to invoke one tool; the caller must
                       execute it and feed the result back in the next call.
    * ``done``      — turn completed cleanly. ``finish_reason`` may be
                       ``"stop"`` / ``"tool_calls"`` / ``"length"``.
    * ``error``     — non-recoverable failure; ``error`` carries the message.
    """
    type: Literal["text", "tool_call", "done", "error"]
    text: Optional[str] = None
    tool_call: Optional[ToolCall] = None
    finish_reason: Optional[str] = None
    error: Optional[str] = None


class ProviderError(RuntimeError):
    """Raised for configuration or transport failures inside a provider."""


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """Abstract async streaming chat provider with tool-calling support."""

    name: str = "base"

    def __init__(self, model: str) -> None:
        self.model = model

    @abstractmethod
    async def stream_chat(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolSpec]] = None,
        *,
        temperature: float = 0.4,
        max_output_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:  # pragma: no cover - abstract
        """Yield ``StreamEvent`` objects for a single model turn.

        The final event MUST be a ``done`` or ``error`` sentinel so callers
        can cleanly close the stream. The iterator is cancellable — dropping
        it (e.g. from an ``asyncio.CancelledError``) must not leak sockets.
        """
        raise NotImplementedError
        yield  # keep type checker happy for async generator signature


# ---------------------------------------------------------------------------
# Gemini (default) — uses the new google-genai SDK
# ---------------------------------------------------------------------------

class GeminiProvider(LLMProvider):
    """Google Gemini provider backed by the ``google-genai`` SDK.

    Supports streaming text + native function-calling (tool use). The SDK is
    imported lazily so environments without the package still boot as long
    as they don't select this provider.
    """

    name = "gemini"

    def __init__(self, model: str, api_key: str) -> None:
        super().__init__(model)
        try:
            from google import genai  # type: ignore
            from google.genai import types as genai_types  # type: ignore
        except ImportError as exc:  # pragma: no cover - env issue
            raise ProviderError(
                "google-genai SDK is not installed. `pip install google-genai`."
            ) from exc

        if not api_key:
            raise ProviderError("GEMINI_API_KEY is not set in the environment.")

        self._client = genai.Client(api_key=api_key)
        self._types = genai_types

    # -- helpers ---------------------------------------------------------

    def _to_genai_contents(self, messages: List[ChatMessage]) -> tuple[Optional[str], list]:
        """Split incoming messages into (system_instruction, contents[]).

        Gemini expects `system_instruction` at request level and only
        ``user`` / ``model`` roles inside the contents array. Tool
        results are represented as ``function_response`` parts.
        """
        types = self._types
        system_bits: list[str] = []
        contents = []
        for m in messages:
            if m.role == "system":
                if m.content:
                    system_bits.append(m.content)
                continue

            if m.role == "tool":
                # Gemini function_response part
                try:
                    resp = json.loads(m.content) if m.content else {}
                except json.JSONDecodeError:
                    resp = {"result": m.content}
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_function_response(
                            name=m.name or "tool",
                            response=resp if isinstance(resp, dict) else {"result": resp},
                        )],
                    )
                )
                continue

            genai_role = "user" if m.role == "user" else "model"
            parts: list = []
            if m.content:
                parts.append(types.Part.from_text(text=m.content))
            for tc in m.tool_calls:
                fc_part = types.Part.from_function_call(name=tc.name, args=tc.arguments)
                if tc.thought_signature:
                    try:
                        import base64
                        fc_part.thought_signature = base64.b64decode(tc.thought_signature)
                    except Exception:
                        pass
                parts.append(fc_part)
            if not parts:
                # Skip empty assistant echoes — Gemini rejects empty parts
                continue
            contents.append(types.Content(role=genai_role, parts=parts))

        system_instruction = "\n\n".join(system_bits) if system_bits else None
        return system_instruction, contents

    def _to_genai_tools(self, tools: Optional[List[ToolSpec]]):
        if not tools:
            return None
        types = self._types
        declarations = [
            types.FunctionDeclaration(
                name=t.name,
                description=t.description,
                parameters=t.parameters,
            )
            for t in tools
        ]
        return [types.Tool(function_declarations=declarations)]

    # -- streaming -------------------------------------------------------

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolSpec]] = None,
        *,
        temperature: float = 0.4,
        max_output_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:
        types = self._types
        system_instruction, contents = self._to_genai_contents(messages)
        genai_tools = self._to_genai_tools(tools)

        config = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            system_instruction=system_instruction,
            tools=genai_tools,
            # Disable thinking mode so we don't need to echo `thought_signature`
            # back on subsequent tool-turn replays (agent loop is tool-driven).
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )

        loop = asyncio.get_running_loop()

        def _open_stream():
            return self._client.models.generate_content_stream(
                model=self.model,
                contents=contents,
                config=config,
            )

        try:
            stream = await loop.run_in_executor(None, _open_stream)
        except Exception as exc:
            logger.exception("Gemini stream open failed")
            yield StreamEvent(type="error", error=f"Gemini error: {exc}")
            return

        finish_reason: Optional[str] = None
        it = iter(stream)

        def _next_chunk():
            try:
                return next(it)
            except StopIteration:
                return None

        try:
            while True:
                chunk = await loop.run_in_executor(None, _next_chunk)
                if chunk is None:
                    break

                candidates = getattr(chunk, "candidates", None) or []
                for cand in candidates:
                    fr = getattr(cand, "finish_reason", None)
                    if fr is not None:
                        finish_reason = getattr(fr, "name", None) or str(fr)
                    content = getattr(cand, "content", None)
                    if not content:
                        continue
                    for part in getattr(content, "parts", []) or []:
                        # Text token
                        text = getattr(part, "text", None)
                        if text:
                            yield StreamEvent(type="text", text=text)
                            continue
                        # Function call
                        fc = getattr(part, "function_call", None)
                        if fc is not None and getattr(fc, "name", None):
                            args = getattr(fc, "args", None) or {}
                            if hasattr(args, "items"):
                                args_dict = dict(args)
                            else:
                                try:
                                    args_dict = json.loads(args) if isinstance(args, str) else dict(args)
                                except (TypeError, json.JSONDecodeError):
                                    args_dict = {}
                            # Capture thought_signature so we can echo it back
                            # on subsequent turns (required by Gemini as of 2025).
                            sig_bytes = getattr(part, "thought_signature", None)
                            sig_str: Optional[str] = None
                            if sig_bytes:
                                try:
                                    import base64
                                    sig_str = base64.b64encode(sig_bytes).decode("ascii")
                                except Exception:
                                    sig_str = None
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCall(
                                    id=f"call_{uuid.uuid4().hex[:12]}",
                                    name=fc.name,
                                    arguments=args_dict,
                                    thought_signature=sig_str,
                                ),
                            )
        except asyncio.CancelledError:
            logger.info("Gemini stream cancelled by caller")
            raise
        except Exception as exc:
            logger.exception("Gemini stream iteration failed")
            yield StreamEvent(type="error", error=f"Gemini stream error: {exc}")
            return

        yield StreamEvent(type="done", finish_reason=finish_reason or "stop")


# ---------------------------------------------------------------------------
# OpenAI-compatible providers (OpenAI, OpenRouter, Ollama with OpenAI compat)
# ---------------------------------------------------------------------------

class OpenAICompatibleProvider(LLMProvider):
    """Provider for any endpoint that speaks the OpenAI Chat Completions API.

    This one class powers OpenAI itself, OpenRouter, and Ollama (via its
    OpenAI-compatible ``/v1`` endpoint). Subclasses only need to set the
    default base URL and pick up the right env var.
    """

    default_base_url: str = "https://api.openai.com/v1"
    env_key: str = "OPENAI_API_KEY"

    def __init__(self, model: str, api_key: Optional[str] = None, base_url: Optional[str] = None) -> None:
        super().__init__(model)
        try:
            import httpx  # noqa: F401  (imported lazily inside stream_chat)
        except ImportError as exc:  # pragma: no cover
            raise ProviderError("httpx must be installed for OpenAI-compatible providers.") from exc
        self.api_key = api_key or os.environ.get(self.env_key, "")
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        if not self.api_key and self.name != "ollama":
            raise ProviderError(f"{self.env_key} is not set in the environment.")

    def _to_openai_messages(self, messages: List[ChatMessage]) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            base: dict = {"role": m.role, "content": m.content or ""}
            if m.role == "tool":
                base["tool_call_id"] = m.tool_call_id or ""
                base["name"] = m.name or "tool"
            if m.role == "assistant" and m.tool_calls:
                base["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                    }
                    for tc in m.tool_calls
                ]
            out.append(base)
        return out

    def _to_openai_tools(self, tools: Optional[List[ToolSpec]]):
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in tools
        ]

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolSpec]] = None,
        *,
        temperature: float = 0.4,
        max_output_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:
        import httpx

        payload: dict = {
            "model": self.model,
            "messages": self._to_openai_messages(messages),
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": True,
        }
        openai_tools = self._to_openai_tools(tools)
        if openai_tools:
            payload["tools"] = openai_tools

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # tool_call accumulator by index (OpenAI streams tool args char-by-char)
        pending: Dict[int, Dict[str, Any]] = {}
        finish_reason: Optional[str] = None

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                ) as resp:
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        yield StreamEvent(
                            type="error",
                            error=f"{self.name} HTTP {resp.status_code}: {body[:400].decode(errors='ignore')}",
                        )
                        return
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choice = (chunk.get("choices") or [{}])[0]
                        delta = choice.get("delta") or {}
                        fr = choice.get("finish_reason")
                        if fr:
                            finish_reason = fr
                        content = delta.get("content")
                        if content:
                            yield StreamEvent(type="text", text=content)
                        for tc_delta in delta.get("tool_calls", []) or []:
                            idx = tc_delta.get("index", 0)
                            slot = pending.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                            if tc_delta.get("id"):
                                slot["id"] = tc_delta["id"]
                            fn = tc_delta.get("function") or {}
                            if fn.get("name"):
                                slot["name"] = fn["name"]
                            if fn.get("arguments"):
                                slot["arguments"] += fn["arguments"]
        except asyncio.CancelledError:
            logger.info("%s stream cancelled by caller", self.name)
            raise
        except Exception as exc:
            logger.exception("%s stream failed", self.name)
            yield StreamEvent(type="error", error=f"{self.name} stream error: {exc}")
            return

        # Flush any completed tool calls
        for slot in pending.values():
            if slot.get("name"):
                try:
                    args = json.loads(slot["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                yield StreamEvent(
                    type="tool_call",
                    tool_call=ToolCall(
                        id=slot.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                        name=slot["name"],
                        arguments=args,
                    ),
                )

        yield StreamEvent(type="done", finish_reason=finish_reason or "stop")


class OpenAIProvider(OpenAICompatibleProvider):
    name = "openai"
    default_base_url = "https://api.openai.com/v1"
    env_key = "OPENAI_API_KEY"


class OpenRouterProvider(OpenAICompatibleProvider):
    name = "openrouter"
    default_base_url = "https://openrouter.ai/api/v1"
    env_key = "OPENROUTER_API_KEY"


class OllamaProvider(OpenAICompatibleProvider):
    """Ollama's OpenAI-compatible endpoint (``/v1/chat/completions``)."""
    name = "ollama"
    default_base_url = "http://localhost:11434/v1"
    env_key = "OLLAMA_API_KEY"  # ignored — Ollama doesn't require auth

    def __init__(self, model: str, api_key: Optional[str] = None, base_url: Optional[str] = None) -> None:
        base_url = base_url or os.environ.get("OLLAMA_BASE_URL") or self.default_base_url
        # Bypass the "key required" check by passing a placeholder
        super().__init__(model, api_key=api_key or "ollama", base_url=base_url)


# ---------------------------------------------------------------------------
# Anthropic (Claude) — native Messages API
# ---------------------------------------------------------------------------

class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider using the native Messages streaming API."""

    name = "anthropic"

    def __init__(self, model: str, api_key: str) -> None:
        super().__init__(model)
        if not api_key:
            raise ProviderError("ANTHROPIC_API_KEY is not set.")
        self.api_key = api_key

    def _to_anthropic_messages(self, messages: List[ChatMessage]) -> tuple[str, list[dict]]:
        system_bits: list[str] = []
        out: list[dict] = []
        for m in messages:
            if m.role == "system":
                if m.content:
                    system_bits.append(m.content)
                continue
            if m.role == "tool":
                out.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.tool_call_id or "",
                        "content": m.content or "",
                    }],
                })
                continue
            if m.role == "assistant" and m.tool_calls:
                blocks: list[dict] = []
                if m.content:
                    blocks.append({"type": "text", "text": m.content})
                for tc in m.tool_calls:
                    blocks.append({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    })
                out.append({"role": "assistant", "content": blocks})
                continue
            out.append({"role": m.role, "content": m.content or ""})
        return "\n\n".join(system_bits), out

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolSpec]] = None,
        *,
        temperature: float = 0.4,
        max_output_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:
        import httpx

        system_instruction, msgs = self._to_anthropic_messages(messages)
        payload: dict = {
            "model": self.model,
            "messages": msgs,
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": True,
        }
        if system_instruction:
            payload["system"] = system_instruction
        if tools:
            payload["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters}
                for t in tools
            ]

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        pending_tool: Optional[Dict[str, Any]] = None
        finish_reason: Optional[str] = None

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json=payload,
                ) as resp:
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        yield StreamEvent(
                            type="error",
                            error=f"Anthropic HTTP {resp.status_code}: {body[:400].decode(errors='ignore')}",
                        )
                        return
                    event_name: Optional[str] = None
                    async for line in resp.aiter_lines():
                        if line.startswith("event:"):
                            event_name = line[6:].strip()
                            continue
                        if not line.startswith("data:"):
                            continue
                        try:
                            data = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            continue
                        t = data.get("type") or event_name
                        if t == "content_block_start":
                            block = data.get("content_block") or {}
                            if block.get("type") == "tool_use":
                                pending_tool = {
                                    "id": block.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                                    "name": block.get("name") or "",
                                    "arguments": "",
                                }
                        elif t == "content_block_delta":
                            delta = data.get("delta") or {}
                            if delta.get("type") == "text_delta" and delta.get("text"):
                                yield StreamEvent(type="text", text=delta["text"])
                            elif delta.get("type") == "input_json_delta" and pending_tool is not None:
                                pending_tool["arguments"] += delta.get("partial_json", "")
                        elif t == "content_block_stop" and pending_tool is not None:
                            try:
                                args = json.loads(pending_tool["arguments"] or "{}")
                            except json.JSONDecodeError:
                                args = {}
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCall(
                                    id=pending_tool["id"],
                                    name=pending_tool["name"],
                                    arguments=args,
                                ),
                            )
                            pending_tool = None
                        elif t == "message_delta":
                            delta = data.get("delta") or {}
                            if delta.get("stop_reason"):
                                finish_reason = delta["stop_reason"]
        except asyncio.CancelledError:
            logger.info("Anthropic stream cancelled by caller")
            raise
        except Exception as exc:
            logger.exception("Anthropic stream failed")
            yield StreamEvent(type="error", error=f"Anthropic stream error: {exc}")
            return

        yield StreamEvent(type="done", finish_reason=finish_reason or "stop")


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_PROVIDER_CACHE: dict[str, LLMProvider] = {}


def get_provider(name: Optional[str] = None, model: Optional[str] = None) -> LLMProvider:
    """Return an initialised provider (cached by ``name+model``).

    Reads ``AI_PROVIDER`` and ``AI_MODEL`` from the environment when
    arguments are omitted. Raises ``ProviderError`` if configuration is
    missing or invalid.
    """
    provider_name = (name or os.environ.get("AI_PROVIDER") or "gemini").strip().lower()
    provider_model = model or os.environ.get("AI_MODEL") or _default_model(provider_name)

    cache_key = f"{provider_name}::{provider_model}"
    cached = _PROVIDER_CACHE.get(cache_key)
    if cached is not None:
        return cached

    if provider_name == "gemini":
        instance: LLMProvider = GeminiProvider(
            model=provider_model,
            api_key=os.environ.get("GEMINI_API_KEY", ""),
        )
    elif provider_name == "openai":
        instance = OpenAIProvider(
            model=provider_model,
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        )
    elif provider_name == "anthropic":
        instance = AnthropicProvider(
            model=provider_model,
            api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        )
    elif provider_name == "openrouter":
        instance = OpenRouterProvider(
            model=provider_model,
            api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        )
    elif provider_name == "ollama":
        instance = OllamaProvider(
            model=provider_model,
            base_url=os.environ.get("OLLAMA_BASE_URL"),
        )
    else:
        raise ProviderError(f"Unknown AI_PROVIDER: {provider_name!r}")

    logger.info("Initialised AI provider %s (model=%s)", provider_name, provider_model)
    _PROVIDER_CACHE[cache_key] = instance
    return instance


def _default_model(provider_name: str) -> str:
    return {
        "gemini": "gemini-2.0-flash",
        "openai": "gpt-4o-mini",
        "anthropic": "claude-sonnet-4-5",
        "openrouter": "openai/gpt-4o-mini",
        "ollama": "llama3.1",
    }.get(provider_name, "gemini-2.0-flash")


def reset_provider_cache() -> None:
    """Drop cached provider clients — useful for tests or hot-reload."""
    _PROVIDER_CACHE.clear()


__all__ = [
    "ChatMessage",
    "ToolCall",
    "ToolSpec",
    "StreamEvent",
    "LLMProvider",
    "GeminiProvider",
    "OpenAIProvider",
    "AnthropicProvider",
    "OpenRouterProvider",
    "OllamaProvider",
    "ProviderError",
    "get_provider",
    "reset_provider_cache",
]
