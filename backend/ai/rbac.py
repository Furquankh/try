"""RBAC helpers for the IQAC Personal AI Agent.

These functions are the *only* place where user identity turns into
permission decisions inside the AI subsystem. Every tool must call one of
these helpers before it touches Mongo — never open-code role checks.

The rules here intentionally mirror the ones in ``backend/server.py`` so the
agent behaves identically to a user clicking through the portal by hand:

* Admin & IQAC Coordinator can see everything.
* HOD sees their own department.
* Staff sees only their own drafts + any approved (public) report.
* Exam Time Table management is restricted to Admin, IQAC Coordinator, or
  members of the (active) ``EXAM`` committee.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from bson import ObjectId

from .schemas import UserContext

logger = logging.getLogger("iqac.ai.rbac")


# ---------------------------------------------------------------------------
# Building a UserContext
# ---------------------------------------------------------------------------

async def build_user_context(db, user_doc: Dict[str, Any]) -> UserContext:
    """Assemble a ``UserContext`` from a raw ``users`` document.

    Also joins ``departments`` (for the display name) and ``committees``
    (to derive ``committee_codes`` used by the exam-timetable RBAC check).
    """
    uid = str(user_doc["_id"])

    department_name: Optional[str] = None
    dept_id = user_doc.get("department_id")
    if dept_id:
        try:
            dept = await db.departments.find_one({"_id": ObjectId(dept_id)})
            if dept:
                department_name = dept.get("name")
        except Exception:
            logger.debug("Could not resolve department %s", dept_id)

    committee_ids: List[str] = list(user_doc.get("committee_ids") or [])
    committee_codes: List[str] = []
    if committee_ids:
        try:
            oids = [ObjectId(cid) for cid in committee_ids]
            async for c in db.committees.find(
                {"_id": {"$in": oids}, "active": {"$ne": False}},
                {"code": 1},
            ):
                if c.get("code"):
                    committee_codes.append(c["code"])
        except Exception:
            logger.exception("Could not resolve committees for %s", uid)

    return UserContext(
        id=uid,
        email=user_doc.get("email", ""),
        name=user_doc.get("name", ""),
        role=user_doc.get("role", "staff"),
        department_id=dept_id,
        department_name=department_name,
        committee_ids=committee_ids,
        committee_codes=committee_codes,
    )


# ---------------------------------------------------------------------------
# Query scoping — apply the same rules the portal endpoints use
# ---------------------------------------------------------------------------

def scope_reports_query(user: UserContext, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return a Mongo filter for ``db.reports`` that respects the user's role.

    * admin / coordinator: no scope, plus any ``extra`` filters.
    * hod: only their department.
    * staff: only their own drafts OR approved reports (public archive).
    """
    query: Dict[str, Any] = dict(extra or {})
    if user.role in ("admin", "coordinator"):
        return query
    if user.role == "hod":
        query["department_id"] = user.department_id
        return query
    # staff
    scope_clause = {"$or": [{"created_by": user.id}, {"status": "approved"}]}
    if "$and" in query:
        query["$and"].append(scope_clause)
    else:
        # merge with any existing $or/etc via $and
        query["$and"] = [scope_clause]
    return query


def scope_users_query(user: UserContext) -> Dict[str, Any]:
    """Users a given identity is allowed to list (matches /api/users)."""
    if user.role in ("admin", "coordinator"):
        return {}
    if user.role == "hod":
        return {"department_id": user.department_id}
    # staff: only themselves
    return {"_id": ObjectId(user.id)}


def can_view_report(user: UserContext, report: Dict[str, Any]) -> bool:
    if user.role in ("admin", "coordinator"):
        return True
    if user.role == "hod":
        return report.get("department_id") == user.department_id
    return report.get("created_by") == user.id or report.get("status") == "approved"


def can_edit_report(user: UserContext, report: Dict[str, Any]) -> bool:
    if user.role == "admin":
        return True
    if report.get("status") == "approved":
        return False
    if report.get("created_by") == user.id and report.get("status") in ("draft", "revision_requested"):
        return True
    return False


def can_manage_exam_timetable(user: UserContext) -> bool:
    """Admin, IQAC Coordinator, or members of the active Exam committee."""
    return user.can_manage_exam_timetable


def can_manage_own(user: UserContext, doc: Dict[str, Any]) -> bool:
    """Owner-or-admin rule used for notices and non-exam timetables."""
    if user.role == "admin":
        return True
    return doc.get("created_by") == user.id


# ---------------------------------------------------------------------------
# Refusal messages — shown verbatim by tools that decline to answer.
# ---------------------------------------------------------------------------

REFUSAL_OTHER_USER = (
    "I can only report on your own data. That request would expose "
    "information belonging to another user, which your current role isn't "
    "authorised to see."
)

REFUSAL_ADMIN_ONLY = (
    "That action is restricted to portal administrators. I don't manage "
    "users, departments, committees, roles, passwords, or system settings."
)

REFUSAL_EXAM_RBAC = (
    "Creating or editing an Exam Time Table requires membership in the Exam "
    "Committee (or Admin / IQAC Coordinator). Please ask the Admin to add "
    "you to the Exam Committee first."
)


__all__ = [
    "build_user_context",
    "scope_reports_query",
    "scope_users_query",
    "can_view_report",
    "can_edit_report",
    "can_manage_exam_timetable",
    "can_manage_own",
    "REFUSAL_OTHER_USER",
    "REFUSAL_ADMIN_ONLY",
    "REFUSAL_EXAM_RBAC",
]
