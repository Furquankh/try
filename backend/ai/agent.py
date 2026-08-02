"""Agent loop for the IQAC Personal AI Agent.

This is the orchestrator that ties together:

* :mod:`providers`  – LLM streaming + tool calling
* :mod:`tools`      – RBAC-scoped tool registry
* :mod:`sessions`   – persistent chat memory + pause/resume/cancel control
* :mod:`schemas`    – wire format for events and messages

The single public entry point is :meth:`Agent.run` which is an async
generator of :class:`AIEventEnvelope` values. The routes layer consumes
this iterator and forwards each frame to the browser over SSE.
"""
from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Dict, List, Optional

from .providers import (
    ChatMessage as ProviderMessage,
    LLMProvider,
    StreamEvent,
    ToolCall as ProviderToolCall,
    get_provider,
)
from .schemas import (
    AIEventEnvelope,
    ChatRequest,
    PageContext,
    StoredMessage,
    StoredToolCall,
    ToolResult,
    UserContext,
)
from .sessions import SessionControl, SessionStore, get_control
from .tools import ToolRegistry

logger = logging.getLogger("iqac.ai.agent")

# Hard limits — protect against runaway tool loops.
MAX_TOOL_TURNS = 6
MAX_INPUT_HISTORY = 20


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEMPLATE = """You are Aarya, the personal AI assistant embedded inside the IQAC (Internal Quality Assurance Cell) Portal of Ramsheth Thakur College of Commerce & Science. You are NOT a general-purpose chatbot — you are an in-portal collaborator that helps ONE specific logged-in user work faster inside the portal they are already using.

# The user you are talking to right now
- Name: {user_name}
- Email: {user_email}
- Role: {user_role_label} ({user_role})
- Department: {user_department}
- Committee memberships: {user_committees}
- Can manage Exam Time Tables: {can_exam}
- Can see all reports (admin/coordinator): {can_all_reports}

# What you can do
- Answer natural-language questions about the user's portal data (their IQAC reports, notices, timetables, announcements, committee memberships, dashboard stats).
- Search, summarise, and explain the user's own documents.
- Draft new IQAC reports, notices, announcements, and exam/daily time tables — but only via the *prepare_*_draft* tools, which produce a plan the browser then fills into the existing form field by field. You NEVER save or submit anything. The user reviews and clicks Save themselves.
- Answer general questions about how the portal works.

# What you must NEVER do
- Never expose another user's data. All reads default to the caller's own scope enforced by the backend. If you cannot see it, do not fabricate it.
- Never manage users, departments, committees, roles, passwords, RBAC, PDF footer settings, or database schema. If the user asks, politely refuse and suggest they contact the portal Administrator.
- Never invent report ids, dates, or numbers. Use tools to look them up.
- Never save, submit, or approve on the user's behalf. Only draft.
- Never bypass the Exam Time Table RBAC. If ``can_exam`` above is False and the user asks you to create/edit an exam timetable, refuse and explain that Exam Committee membership is required.

# How to answer
- Detect the current portal page from ``page_context`` (below) and tailor your response. If they are already on /reports/new, don't tell them to "open the reports form"; just draft directly.
- Prefer calling tools over speculating. If a question needs data, call a tool.
- Keep answers concise and Markdown-formatted. Use short bulleted lists for report/notice listings.
- When you draft a form, briefly summarise what you filled and remind the user to review and save.
- If the user's request is ambiguous, ask ONE clarifying question at most, then proceed.

# Current portal page
{page_context}

# Today
{today_line}
"""


def build_system_prompt(user: UserContext, page: Optional[PageContext], today_line: str) -> str:
    return _SYSTEM_PROMPT_TEMPLATE.format(
        user_name=user.name or "(unknown)",
        user_email=user.email or "(unknown)",
        user_role=user.role,
        user_role_label={
            "admin": "Principal / Administrator",
            "coordinator": "IQAC Coordinator",
            "hod": "Head of Department",
            "staff": "Faculty / Staff",
        }.get(user.role, user.role),
        user_department=user.department_name or user.department_id or "—",
        user_committees=", ".join(user.committee_codes) or "none",
        can_exam="Yes" if user.can_manage_exam_timetable else "No",
        can_all_reports="Yes" if user.can_see_all_reports else "No",
        page_context=_format_page_context(page),
        today_line=today_line,
    )


def _format_page_context(page: Optional[PageContext]) -> str:
    if not page or not page.path:
        return "Unknown (assume Dashboard)."
    parts = [f"path={page.path}"]
    if page.route:
        parts.append(f"route={page.route}")
    if page.entity_id:
        parts.append(f"entity_id={page.entity_id}")
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class Agent:
    """Orchestrates one chat turn end-to-end."""

    def __init__(
        self,
        db: Any,
        registry: ToolRegistry,
        store: SessionStore,
        provider: Optional[LLMProvider] = None,
    ) -> None:
        self._db = db
        self._registry = registry
        self._store = store
        self._provider = provider

    def _get_provider(self, req: ChatRequest) -> LLMProvider:
        if self._provider is not None:
            return self._provider
        return get_provider(name=req.provider, model=req.model)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def run(
        self,
        req: ChatRequest,
        user: UserContext,
        today_line: str,
    ) -> AsyncIterator[AIEventEnvelope]:
        """Yield SSE frames for one user message.

        Steps:

        1. Load or create the session, append the user's message.
        2. Build system prompt + provider message list.
        3. Loop: stream provider → if it emits ``tool_call`` events, execute
           them, feed results back, stream again. Cap at ``MAX_TOOL_TURNS``.
        4. Persist assistant + tool messages, update session status.
        """
        # ---- session bootstrap ---------------------------------------
        session = None
        if req.session_id:
            session = await self._store.get(req.session_id, user)
        if session is None:
            session = await self._store.create(
                user,
                title=None,
                provider=(req.provider or "gemini"),
                model=(req.model or "gemini-2.0-flash"),
            )

        control = get_control(session.id)

        yield AIEventEnvelope(type="session", payload={
            "session_id": session.id,
            "title": session.title,
            "status": "thinking",
        })

        # Track page context
        if req.page_context and req.page_context.path:
            await self._store.set_page(session.id, user, req.page_context.path)

        # Persist the user turn immediately
        user_msg = StoredMessage(role="user", content=req.message)
        await self._store.append_messages(session.id, user, [user_msg])
        await self._store.auto_title_if_needed(session.id, user, req.message)
        await self._store.set_status(session.id, user, "thinking")

        # ---- assemble history for the provider -----------------------
        system_prompt = build_system_prompt(user, req.page_context, today_line)
        provider_msgs: List[ProviderMessage] = [ProviderMessage(role="system", content=system_prompt)]
        raw_history = (session.messages or [])[-MAX_INPUT_HISTORY:] + [user_msg]
        for m in raw_history:
            # Skip stale tool_call replays from prior sessions — they don't
            # carry Gemini's ``thought_signature`` and would be rejected on
            # replay. The user-visible assistant text from those turns is
            # sufficient context for the model.
            if m.role == "tool":
                continue
            if m.role == "assistant" and m.tool_calls and not (m.content or "").strip():
                continue
            provider_msgs.append(ProviderMessage(
                role=m.role,
                content=m.content or "",
            ))

        provider = self._get_provider(req)
        tool_specs = self._registry.specs()

        assistant_buffer_text = ""
        assistant_tool_calls: List[StoredToolCall] = []
        turn_index = 0
        finish_reason: Optional[str] = None

        try:
            while turn_index < MAX_TOOL_TURNS:
                turn_index += 1
                logger.debug("Agent turn %d for session %s", turn_index, session.id)

                # Stream one provider turn
                turn_text = ""
                turn_tool_calls: List[ProviderToolCall] = []

                async for ev in provider.stream_chat(provider_msgs, tools=tool_specs):
                    # ---- honour user controls -----------------------
                    if control.is_cancelled:
                        yield AIEventEnvelope(type="cancelled", payload={})
                        return
                    if control.is_paused:
                        yield AIEventEnvelope(type="paused", payload={})
                        await control.wait_if_paused()
                        if control.is_cancelled:
                            yield AIEventEnvelope(type="cancelled", payload={})
                            return
                        yield AIEventEnvelope(type="resumed", payload={})

                    # ---- forward the event --------------------------
                    if ev.type == "text" and ev.text:
                        turn_text += ev.text
                        yield AIEventEnvelope(type="text_delta", payload={"text": ev.text})
                    elif ev.type == "tool_call" and ev.tool_call is not None:
                        turn_tool_calls.append(ev.tool_call)
                    elif ev.type == "error":
                        yield AIEventEnvelope(type="error", payload={"message": ev.error or "unknown"})
                        await self._store.set_status(session.id, user, "error")
                        return
                    elif ev.type == "done":
                        finish_reason = ev.finish_reason

                if turn_text:
                    assistant_buffer_text += turn_text

                # No tool calls → end of turn.
                if not turn_tool_calls:
                    break

                # Otherwise: execute each tool, add its result, then loop.
                # First, record the assistant tool-call turn into provider_msgs
                # so the model has a coherent conversation for the next pass.
                provider_msgs.append(ProviderMessage(
                    role="assistant",
                    content=turn_text,
                    tool_calls=list(turn_tool_calls),
                ))

                for tc in turn_tool_calls:
                    yield AIEventEnvelope(type="tool_call_start", payload={
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "arguments": tc.arguments,
                    })
                    await self._store.set_status(session.id, user, "tool_running")

                    stored_tc = StoredToolCall(
                        id=tc.id, name=tc.name, arguments=tc.arguments,
                    )
                    result: ToolResult
                    tool = self._registry.get(tc.name)
                    if tool is None:
                        result = ToolResult.failure(f"Unknown tool: {tc.name}")
                    else:
                        try:
                            result = await tool.run(tc.arguments, user, self._db)
                        except Exception as exc:  # pragma: no cover - safety net
                            logger.exception("Tool %s crashed", tc.name)
                            result = ToolResult.failure(f"Tool crashed: {exc}")

                    stored_tc.result = None if result.data is None else _safe_json(result.data)
                    stored_tc.error = result.error

                    # If this is a form_fill hint, emit the plan straight to
                    # the client BEFORE feeding the result back to the model.
                    if result.ok and result.ui_hint and result.ui_hint.get("action") == "form_fill":
                        yield AIEventEnvelope(type="form_fill_plan", payload={
                            "tool_call_id": tc.id,
                            "plan": result.data,
                        })
                        await self._store.set_status(session.id, user, "form_filling")

                    # Emit tool_result for the UI
                    yield AIEventEnvelope(type="tool_result", payload={
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "ok": result.ok,
                        "result": stored_tc.result,
                        "error": stored_tc.error,
                    })

                    # Feed the result back to the model
                    provider_msgs.append(ProviderMessage(
                        role="tool",
                        name=tc.name,
                        tool_call_id=tc.id,
                        content=json.dumps(result.to_llm_payload(), default=str),
                    ))
                    assistant_tool_calls.append(stored_tc)

                await self._store.set_status(session.id, user, "thinking")
                # Loop back for the next provider turn.

            # ---- End of tool loop -----------------------------------
            yield AIEventEnvelope(type="message_end", payload={
                "finish_reason": finish_reason or "stop",
            })

            # Persist the assistant message (with any tool calls it made).
            assistant_msg = StoredMessage(
                role="assistant",
                content=assistant_buffer_text.strip(),
                tool_calls=assistant_tool_calls,
            )
            # Also persist tool messages so we can rehydrate future turns.
            tool_msgs: List[StoredMessage] = []
            for tc in assistant_tool_calls:
                tool_msgs.append(StoredMessage(
                    role="tool",
                    name=None,
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    content=json.dumps({"ok": tc.error is None, "data": tc.result, "error": tc.error}, default=str),
                ))
            to_persist: List[StoredMessage] = []
            if assistant_msg.content or assistant_msg.tool_calls:
                to_persist.append(assistant_msg)
            to_persist.extend(tool_msgs)
            if to_persist:
                await self._store.append_messages(session.id, user, to_persist)

            await self._store.set_status(session.id, user, "done")
            yield AIEventEnvelope(type="done", payload={"session_id": session.id})

        except Exception as exc:  # pragma: no cover - safety net
            logger.exception("Agent loop crashed for session %s", session.id)
            await self._store.set_status(session.id, user, "error")
            yield AIEventEnvelope(type="error", payload={"message": f"Agent error: {exc}"})


def _safe_json(value: Any) -> Any:
    """Round-trip through JSON to strip non-serialisable objects."""
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return {"repr": str(value)}


__all__ = ["Agent", "build_system_prompt"]
