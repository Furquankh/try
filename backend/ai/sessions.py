"""Persistent chat-session store for the IQAC Personal AI Agent.

Sessions are stored in the ``ai_sessions`` Mongo collection (one document per
conversation). This module provides the async CRUD + a lightweight in-process
control channel so the browser's Pause/Resume/Stop buttons can influence the
agent loop mid-turn.

Design notes
------------
* Session ownership is enforced by ``user_id``. Every lookup that mutates a
  session verifies the caller. The routes layer wires this to the JWT-user.
* Control state (pause / cancel) lives only in memory — restarting the
  backend cancels active turns, which is the desired behaviour.
* Message history is stored as a plain list on the session document. For
  the MVP that's fine (bounded by conversation length); if it grows we can
  move to a separate ``ai_messages`` collection later without changing the
  public API of this module.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .schemas import (
    AISession,
    AISessionSummary,
    AgentStatus,
    StoredMessage,
    UserContext,
)

logger = logging.getLogger("iqac.ai.sessions")


# ---------------------------------------------------------------------------
# In-process control channel
# ---------------------------------------------------------------------------

class SessionControl:
    """Lightweight signalling primitive used by the agent loop.

    Each active session has one of these. The producing coroutine (the
    agent loop) polls ``paused`` and ``cancelled`` between tool calls and
    between streamed tokens. The HTTP control endpoint flips the flags.
    """
    __slots__ = ("_paused", "_resume", "_cancelled")

    def __init__(self) -> None:
        self._paused: bool = False
        self._resume: asyncio.Event = asyncio.Event()
        self._resume.set()  # start un-paused
        self._cancelled: bool = False

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    def pause(self) -> None:
        if not self._paused:
            self._paused = True
            self._resume.clear()

    def resume(self) -> None:
        if self._paused:
            self._paused = False
            self._resume.set()

    def cancel(self) -> None:
        self._cancelled = True
        # If paused, unblock the waiter so it can observe the cancel.
        self._resume.set()

    async def wait_if_paused(self) -> None:
        """Block until ``resume()`` or ``cancel()`` is called."""
        if self._resume.is_set():
            return
        await self._resume.wait()


class ControlRegistry:
    """Process-local map of ``session_id -> SessionControl``."""

    def __init__(self) -> None:
        self._map: Dict[str, SessionControl] = {}

    def get_or_create(self, session_id: str) -> SessionControl:
        ctrl = self._map.get(session_id)
        if ctrl is None:
            ctrl = SessionControl()
            self._map[session_id] = ctrl
        return ctrl

    def get(self, session_id: str) -> Optional[SessionControl]:
        return self._map.get(session_id)

    def drop(self, session_id: str) -> None:
        self._map.pop(session_id, None)


_controls = ControlRegistry()


def get_control(session_id: str) -> SessionControl:
    return _controls.get_or_create(session_id)


def peek_control(session_id: str) -> Optional[SessionControl]:
    return _controls.get(session_id)


# ---------------------------------------------------------------------------
# Mongo-backed session store
# ---------------------------------------------------------------------------

MAX_MESSAGES_PER_SESSION = 200
"""Hard cap to keep a single document small. Older messages are trimmed."""

TITLE_MAX_LEN = 60


class SessionStore:
    """Async CRUD for chat sessions.

    Constructor takes a Motor database handle so tests can inject an
    in-memory replacement.
    """

    def __init__(self, db: Any) -> None:
        self._db = db
        self._col = db.ai_sessions

    async def ensure_indexes(self) -> None:
        await self._col.create_index("user_id")
        await self._col.create_index([("user_id", 1), ("updated_at", -1)])

    # -- create / read ---------------------------------------------------

    async def create(
        self,
        user: UserContext,
        *,
        title: Optional[str] = None,
        provider: str,
        model: str,
    ) -> AISession:
        session = AISession(
            user_id=user.id,
            title=title or "New conversation",
            provider=provider,
            model=model,
        )
        await self._col.insert_one(self._to_doc(session))
        logger.info("Created session %s for user %s", session.id, user.id)
        return session

    async def get(self, session_id: str, user: UserContext) -> Optional[AISession]:
        doc = await self._col.find_one({"id": session_id, "user_id": user.id})
        if not doc:
            return None
        return self._from_doc(doc)

    async def list_for_user(self, user: UserContext, *, limit: int = 50) -> List[AISessionSummary]:
        cur = self._col.find(
            {"user_id": user.id},
            {"id": 1, "title": 1, "status": 1, "updated_at": 1, "messages": 1},
        ).sort("updated_at", -1).limit(limit)
        out: List[AISessionSummary] = []
        async for d in cur:
            out.append(AISessionSummary(
                id=d.get("id"),
                title=d.get("title") or "Conversation",
                status=d.get("status") or "idle",
                updated_at=d.get("updated_at") or "",
                message_count=len(d.get("messages") or []),
            ))
        return out

    # -- update ----------------------------------------------------------

    async def append_messages(
        self,
        session_id: str,
        user: UserContext,
        messages: List[StoredMessage],
    ) -> None:
        if not messages:
            return
        now = _now_iso()
        docs = [m.model_dump() for m in messages]
        await self._col.update_one(
            {"id": session_id, "user_id": user.id},
            {
                "$push": {"messages": {"$each": docs, "$slice": -MAX_MESSAGES_PER_SESSION}},
                "$set": {"updated_at": now},
            },
        )

    async def set_status(self, session_id: str, user: UserContext, status: AgentStatus) -> None:
        await self._col.update_one(
            {"id": session_id, "user_id": user.id},
            {"$set": {"status": status, "updated_at": _now_iso()}},
        )

    async def set_page(self, session_id: str, user: UserContext, path: Optional[str]) -> None:
        await self._col.update_one(
            {"id": session_id, "user_id": user.id},
            {"$set": {"current_page": path, "updated_at": _now_iso()}},
        )

    async def rename(self, session_id: str, user: UserContext, title: str) -> None:
        clean = (title or "").strip()[:TITLE_MAX_LEN]
        if not clean:
            return
        await self._col.update_one(
            {"id": session_id, "user_id": user.id},
            {"$set": {"title": clean, "updated_at": _now_iso()}},
        )

    async def auto_title_if_needed(self, session_id: str, user: UserContext, first_user_message: str) -> None:
        """Set the title from the first user message if it's still the default."""
        clean = (first_user_message or "").strip().splitlines()[0][:TITLE_MAX_LEN]
        if not clean:
            return
        await self._col.update_one(
            {"id": session_id, "user_id": user.id, "title": "New conversation"},
            {"$set": {"title": clean, "updated_at": _now_iso()}},
        )

    # -- delete ----------------------------------------------------------

    async def delete(self, session_id: str, user: UserContext) -> bool:
        res = await self._col.delete_one({"id": session_id, "user_id": user.id})
        _controls.drop(session_id)
        return res.deleted_count > 0

    # -- helpers ---------------------------------------------------------

    def _to_doc(self, session: AISession) -> Dict[str, Any]:
        return session.model_dump()

    def _from_doc(self, doc: Dict[str, Any]) -> AISession:
        # Strip Mongo's _id (not part of the schema).
        doc = dict(doc)
        doc.pop("_id", None)
        return AISession(**doc)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = [
    "SessionStore",
    "SessionControl",
    "get_control",
    "peek_control",
]
