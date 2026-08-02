"""FastAPI routes for the IQAC Personal AI Agent.

Mounted under ``/api/ai``:

* ``POST   /api/ai/chat``                 — SSE stream of ``AIEventEnvelope``.
* ``POST   /api/ai/sessions``             — create an empty session.
* ``GET    /api/ai/sessions``             — list the caller's sessions.
* ``GET    /api/ai/sessions/{id}``        — hydrate one session's history.
* ``PATCH  /api/ai/sessions/{id}``        — rename.
* ``DELETE /api/ai/sessions/{id}``        — delete.
* ``POST   /api/ai/sessions/{id}/control``— pause/resume/stop/cancel.
* ``GET    /api/ai/config``               — active provider + model + tool names.

Auth reuses the portal's existing JWT dependency; the current user is turned
into a :class:`UserContext` before every request so RBAC is applied
consistently.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from .agent import Agent
from .rbac import build_user_context
from .schemas import (
    AIEventEnvelope,
    ChatControlRequest,
    ChatRequest,
    SessionCreateRequest,
    SessionRenameRequest,
    UserContext,
)
from .sessions import SessionStore, peek_control
from .tools import build_default_registry

logger = logging.getLogger("iqac.ai.routes")


def build_router(
    db: Any,
    get_current_user: Callable,
) -> APIRouter:
    """Assemble the ``/api/ai`` router.

    Parameters
    ----------
    db:
        Motor database handle.
    get_current_user:
        The existing FastAPI dependency used by the rest of the portal so
        every route shares the same JWT-cookie flow.
    """
    router = APIRouter(prefix="/api/ai", tags=["ai-agent"])
    store = SessionStore(db)
    registry = build_default_registry()
    agent = Agent(db=db, registry=registry, store=store)
    _startup_task = {"done": False}

    async def _ensure_indexes() -> None:
        if _startup_task["done"]:
            return
        try:
            await store.ensure_indexes()
        except Exception:  # pragma: no cover - non-fatal
            logger.exception("Failed to build ai_sessions indexes")
        _startup_task["done"] = True

    async def _ctx(user_doc=Depends(get_current_user)) -> UserContext:
        await _ensure_indexes()
        return await build_user_context(db, user_doc)

    # -----------------------------------------------------------------
    # Config
    # -----------------------------------------------------------------

    @router.get("/config")
    async def config(user: UserContext = Depends(_ctx)):
        import os
        return {
            "provider": os.environ.get("AI_PROVIDER", "gemini"),
            "model": os.environ.get("AI_MODEL", "gemini-2.0-flash"),
            "tools": registry.names(),
            "user": {
                "id": user.id,
                "name": user.name,
                "role": user.role,
                "can_manage_exam_timetable": user.can_manage_exam_timetable,
            },
        }

    # -----------------------------------------------------------------
    # Sessions
    # -----------------------------------------------------------------

    @router.post("/sessions")
    async def create_session(payload: SessionCreateRequest, user: UserContext = Depends(_ctx)):
        import os
        session = await store.create(
            user,
            title=payload.title,
            provider=payload.provider or os.environ.get("AI_PROVIDER", "gemini"),
            model=payload.model or os.environ.get("AI_MODEL", "gemini-2.0-flash"),
        )
        return session.model_dump()

    @router.get("/sessions")
    async def list_sessions(user: UserContext = Depends(_ctx)):
        summaries = await store.list_for_user(user)
        return [s.model_dump() for s in summaries]

    @router.get("/sessions/{sid}")
    async def get_session(sid: str, user: UserContext = Depends(_ctx)):
        session = await store.get(sid, user)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session.model_dump()

    @router.patch("/sessions/{sid}")
    async def rename_session(sid: str, payload: SessionRenameRequest, user: UserContext = Depends(_ctx)):
        session = await store.get(sid, user)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        await store.rename(sid, user, payload.title)
        return {"ok": True}

    @router.delete("/sessions/{sid}")
    async def delete_session(sid: str, user: UserContext = Depends(_ctx)):
        ok = await store.delete(sid, user)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"ok": True}

    # -----------------------------------------------------------------
    # Control (pause / resume / stop / cancel / retry)
    # -----------------------------------------------------------------

    @router.post("/sessions/{sid}/control")
    async def control_session(sid: str, payload: ChatControlRequest, user: UserContext = Depends(_ctx)):
        # Ownership check via a session lookup — cheap and safe.
        session = await store.get(sid, user)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        ctrl = peek_control(sid)
        if ctrl is None:
            # No active run to control; treat as a no-op.
            return {"ok": True, "no_active_run": True}
        if payload.action == "pause":
            ctrl.pause()
        elif payload.action == "resume":
            ctrl.resume()
        elif payload.action in ("stop", "cancel"):
            ctrl.cancel()
        # "retry" is handled by the client re-issuing /chat; nothing to do here.
        return {"ok": True}

    # -----------------------------------------------------------------
    # Chat — SSE stream
    # -----------------------------------------------------------------

    @router.post("/chat")
    async def chat(payload: ChatRequest, request: Request, user: UserContext = Depends(_ctx)):
        today_line = _today_line()

        async def event_stream() -> AsyncIterator[bytes]:
            # Initial SSE hint that the connection is alive.
            yield _sse_comment("stream open").encode()
            heartbeat_task: Optional[asyncio.Task] = None
            queue: asyncio.Queue[AIEventEnvelope] = asyncio.Queue(maxsize=256)

            async def producer() -> None:
                try:
                    async for env in agent.run(payload, user, today_line=today_line):
                        await queue.put(env)
                        if env.type in ("done", "error", "cancelled"):
                            break
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # pragma: no cover
                    logger.exception("Chat stream failed")
                    await queue.put(AIEventEnvelope(
                        type="error", payload={"message": f"Server error: {exc}"}
                    ))
                finally:
                    await queue.put(AIEventEnvelope(type="done", payload={}))

            prod = asyncio.create_task(producer())

            async def heartbeat_loop() -> None:
                try:
                    while True:
                        await asyncio.sleep(15)
                        await queue.put(AIEventEnvelope(
                            type="heartbeat",
                            payload={"ts": datetime.now(timezone.utc).isoformat()},
                        ))
                except asyncio.CancelledError:
                    return

            heartbeat_task = asyncio.create_task(heartbeat_loop())

            try:
                while True:
                    # Bail if the client disconnected.
                    if await request.is_disconnected():
                        logger.info("Client disconnected; cancelling agent run")
                        prod.cancel()
                        break
                    try:
                        env = await asyncio.wait_for(queue.get(), timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    yield env.sse().encode()
                    if env.type in ("done", "error", "cancelled") and prod.done():
                        break
            finally:
                if heartbeat_task and not heartbeat_task.done():
                    heartbeat_task.cancel()
                if not prod.done():
                    prod.cancel()
                    try:
                        await prod
                    except (asyncio.CancelledError, Exception):
                        pass

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # for nginx-style proxies
            },
        )

    return router


def _sse_comment(text: str) -> str:
    """SSE comment lines start with ``:`` and are ignored by the client."""
    return f": {text}\n\n"


def _today_line() -> str:
    now = datetime.now(timezone.utc)
    ay_start = now.year if now.month >= 7 else now.year - 1
    return f"{now.date().isoformat()} (academic year {ay_start}-{ay_start + 1})"


__all__ = ["build_router"]
