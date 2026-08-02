"""Pydantic schemas for the IQAC Personal AI Agent.

This module is the single source of truth for every wire-format used by the
AI subsystem:

* HTTP request / response bodies for ``/api/ai/*`` endpoints.
* MongoDB document shapes for the ``ai_sessions`` collection.
* SSE event envelopes streamed to the browser (see ``AIEventEnvelope``).
* The structured ``FormFillPlan`` returned by the LLM when the user asks the
  agent to fill an existing portal form on their behalf.

Nothing here talks to the model or the database — it only *describes*
payloads so upstream/downstream modules stay decoupled and type-safe.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Shared enums / aliases
# ---------------------------------------------------------------------------

MessageRole = Literal["system", "user", "assistant", "tool"]
"""Roles allowed inside a stored chat message."""

AgentStatus = Literal[
    "idle",         # session created, nothing running
    "thinking",     # model is generating the current turn
    "tool_running", # a tool is executing on the backend
    "form_filling", # a FormFillPlan is being streamed to the browser
    "paused",       # user hit pause; producer waits on the resume event
    "cancelled",    # user hit stop; producer bailed cleanly
    "error",        # last turn ended in an error
    "done",         # last turn finished cleanly
]

FormFillFieldStatus = Literal["pending", "filling", "filled", "skipped", "error"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# User context (RBAC snapshot passed into the agent loop)
# ---------------------------------------------------------------------------

class UserContext(BaseModel):
    """Immutable snapshot of the logged-in user's identity and RBAC scope.

    Assembled by the routes layer from the JWT + a DB lookup before any tool
    runs, then passed as-is into every tool invocation. Never trust anything
    the model claims about the user; always compare against this object.
    """
    model_config = ConfigDict(frozen=True)

    id: str
    email: str
    name: str
    role: Literal["admin", "coordinator", "hod", "staff"]
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    committee_ids: List[str] = Field(default_factory=list)
    committee_codes: List[str] = Field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_coordinator(self) -> bool:
        return self.role == "coordinator"

    @property
    def can_see_all_reports(self) -> bool:
        """Admins and IQAC coordinators can query across every department."""
        return self.role in ("admin", "coordinator")

    @property
    def can_manage_exam_timetable(self) -> bool:
        """Admin, IQAC Coordinator, or Exam Committee members only."""
        if self.role in ("admin", "coordinator"):
            return True
        return "EXAM" in {c.upper() for c in self.committee_codes}


# ---------------------------------------------------------------------------
# Persisted chat message (stored in Mongo, echoed back to the client)
# ---------------------------------------------------------------------------

class StoredToolCall(BaseModel):
    """A tool invocation recorded on an assistant message."""
    id: str
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class StoredMessage(BaseModel):
    """One turn in a persisted conversation.

    ``role='tool'`` messages carry the tool's structured result in
    ``content_json``; ``role='assistant'`` messages may contain both natural
    language ``content`` and a list of ``tool_calls``.
    """
    id: str = Field(default_factory=lambda: uuid4().hex)
    role: MessageRole
    content: str = ""
    content_json: Optional[Dict[str, Any]] = None
    tool_calls: List[StoredToolCall] = Field(default_factory=list)
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)


# ---------------------------------------------------------------------------
# Session document
# ---------------------------------------------------------------------------

class AISession(BaseModel):
    """Mongo document representing one chat session."""
    id: str = Field(default_factory=lambda: uuid4().hex)
    user_id: str
    title: str = "New conversation"
    provider: str = "gemini"
    model: str = "gemini-2.0-flash"
    messages: List[StoredMessage] = Field(default_factory=list)
    status: AgentStatus = "idle"
    current_page: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)

    def touch(self) -> None:
        self.updated_at = _now_iso()


class AISessionSummary(BaseModel):
    """Compact projection for the session list endpoint."""
    id: str
    title: str
    status: AgentStatus
    updated_at: str
    message_count: int


# ---------------------------------------------------------------------------
# HTTP request / response bodies
# ---------------------------------------------------------------------------

class PageContext(BaseModel):
    """Client-supplied hint about what portal page the user is looking at."""
    path: Optional[str] = None                # e.g. "/reports/new"
    route: Optional[str] = None               # e.g. "report_form"
    entity_id: Optional[str] = None           # e.g. current report id
    extras: Dict[str, Any] = Field(default_factory=dict)


class ChatRequest(BaseModel):
    """POST /api/ai/chat body.

    A blank ``session_id`` triggers server-side session creation. ``message``
    is the user's raw natural-language input; the agent loop injects the
    system prompt on its own so clients never need to.
    """
    session_id: Optional[str] = None
    message: str = Field(..., min_length=1, max_length=8000)
    page_context: Optional[PageContext] = None
    provider: Optional[str] = None            # override AI_PROVIDER
    model: Optional[str] = None               # override AI_MODEL

    @field_validator("message")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be blank")
        return v


class ChatControlRequest(BaseModel):
    """POST /api/ai/chat/{session_id}/control — pause/resume/stop/cancel."""
    action: Literal["pause", "resume", "stop", "cancel", "retry"]


class SessionCreateRequest(BaseModel):
    title: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None


class SessionRenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


# ---------------------------------------------------------------------------
# Live form-filling — LLM-produced plan the browser executes locally
# ---------------------------------------------------------------------------

class FormFillField(BaseModel):
    """A single field the LLM wants to fill on the currently-open form.

    ``selector`` is the ``data-testid`` (preferred) or CSS selector the
    frontend uses to find the input. ``value`` is either a plain string, a
    number/boolean, or an array (for multi-selects / checkbox groups).
    ``strategy`` tells the frontend how to write the value:

    * ``text``   — set ``value`` and dispatch input/change events.
    * ``select`` — set ``value`` on a ``<select>`` element.
    * ``check``  — set the checkbox/radio checked state.
    * ``append`` — append to existing text (for long textareas).
    """
    selector: str
    label: Optional[str] = None
    value: Any
    strategy: Literal["text", "select", "check", "append"] = "text"
    note: Optional[str] = None
    status: FormFillFieldStatus = "pending"


class FormFillPlan(BaseModel):
    """Structured plan the agent hands to the frontend for live filling."""
    form_id: str                              # matches a route key, e.g. "report_form"
    route: str                                # navigate here first, e.g. "/reports/new"
    intent: str                               # human-readable summary
    fields: List[FormFillField]
    field_delay_ms: int = Field(300, ge=0, le=5000)
    review_message: str = (
        "I've filled in the draft — please review each field, edit anything "
        "you'd like, and click Save when you're ready."
    )


# ---------------------------------------------------------------------------
# SSE event envelope (what the browser actually receives)
# ---------------------------------------------------------------------------

AIEventType = Literal[
    "session",           # payload: {session_id, title, status}
    "status",            # payload: {status: AgentStatus}
    "message_start",     # payload: {message_id, role}
    "text_delta",        # payload: {text}
    "tool_call_start",   # payload: {tool_call_id, name, arguments}
    "tool_result",       # payload: {tool_call_id, result | error}
    "form_fill_plan",    # payload: FormFillPlan
    "form_fill_progress",  # payload: {index, total, field: FormFillField}
    "message_end",       # payload: {message_id, finish_reason}
    "error",             # payload: {message}
    "done",              # payload: {}
    "paused",            # payload: {}
    "resumed",           # payload: {}
    "cancelled",         # payload: {}
    "heartbeat",         # payload: {ts}
]


class AIEventEnvelope(BaseModel):
    """Wire frame for every SSE ``data:`` line the server emits.

    Kept intentionally small — a single string ``type`` and an opaque
    ``payload`` object — so new event kinds can be added without protocol
    changes. The frontend just switches on ``type`` and reads the payload
    fields it knows about.
    """
    type: AIEventType
    payload: Dict[str, Any] = Field(default_factory=dict)
    ts: str = Field(default_factory=_now_iso)

    def sse(self) -> str:
        """Serialise this event as a fully-formed SSE ``data:`` frame.

        Includes a trailing blank line as required by the SSE spec so
        clients dispatch immediately rather than buffering.
        """
        return f"data: {self.model_dump_json()}\n\n"


# ---------------------------------------------------------------------------
# Tool execution result (what tools return to the agent loop)
# ---------------------------------------------------------------------------

class ToolResult(BaseModel):
    """Structured envelope returned by every tool.

    ``data`` is the natural payload (what the LLM sees next turn). ``error``
    is set if the tool failed — the agent will report it back to the user
    without exposing internals. ``ui_hint`` optionally instructs the
    frontend to react (e.g. show a toast, navigate somewhere, or begin a
    form-fill sequence).
    """
    ok: bool = True
    data: Any = None
    error: Optional[str] = None
    ui_hint: Optional[Dict[str, Any]] = None

    @classmethod
    def success(cls, data: Any = None, *, ui_hint: Optional[Dict[str, Any]] = None) -> "ToolResult":
        return cls(ok=True, data=data, ui_hint=ui_hint)

    @classmethod
    def failure(cls, error: str, *, data: Any = None) -> "ToolResult":
        return cls(ok=False, error=error, data=data)

    def to_llm_payload(self) -> Dict[str, Any]:
        """Compact dict handed back to the model as the tool response."""
        out: Dict[str, Any] = {"ok": self.ok}
        if self.data is not None:
            out["data"] = self.data
        if self.error:
            out["error"] = self.error
        return out


__all__ = [
    "MessageRole",
    "AgentStatus",
    "FormFillFieldStatus",
    "UserContext",
    "StoredToolCall",
    "StoredMessage",
    "AISession",
    "AISessionSummary",
    "PageContext",
    "ChatRequest",
    "ChatControlRequest",
    "SessionCreateRequest",
    "SessionRenameRequest",
    "FormFillField",
    "FormFillPlan",
    "AIEventType",
    "AIEventEnvelope",
    "ToolResult",
]
