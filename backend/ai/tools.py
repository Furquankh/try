"""Tool registry for the IQAC Personal AI Agent.

Every tool exposed to the model lives here. The design rules are:

1. **Read-only or draft-only.** Tools may query the database (respecting
   RBAC) or return a ``FormFillPlan`` for the browser to execute live, but
   they never write to Mongo directly. Saving is always a manual user
   action on the actual portal form.
2. **RBAC via ``rbac.py``.** Every tool calls one of ``scope_*_query``,
   ``can_*``, or references ``UserContext`` before returning data.
3. **Structured results.** Tools return :class:`ToolResult`; failures
   produce polite refusal messages, never internal errors.
4. **No admin concerns.** User / department / committee / RBAC / password /
   settings management is refused outright — the agent is a *user assistant*,
   not an admin console.

To add a new capability, subclass :class:`Tool`, implement ``spec()`` and
``run()``, and add it to :func:`build_default_registry`.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId

from .providers import ToolSpec
from .rbac import (
    REFUSAL_ADMIN_ONLY,
    REFUSAL_EXAM_RBAC,
    can_manage_exam_timetable,
    scope_reports_query,
)
from .schemas import (
    FormFillField,
    FormFillPlan,
    ToolResult,
    UserContext,
)

logger = logging.getLogger("iqac.ai.tools")

STATUS_LABELS = {
    "draft": "Draft",
    "submitted": "Submitted",
    "under_review": "Under Review",
    "approved": "Approved",
    "rejected": "Rejected",
    "revision_requested": "Revision Requested",
}


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

class Tool(ABC):
    """Contract every tool implements."""

    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = {"type": "object", "properties": {}}
    admin_only: bool = False

    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
        )

    @abstractmethod
    async def run(
        self,
        args: Dict[str, Any],
        user: UserContext,
        db: Any,
    ) -> ToolResult:  # pragma: no cover - abstract
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Ordered collection of tools with lookup + spec-list helpers."""

    def __init__(self, tools: Optional[List[Tool]] = None) -> None:
        self._tools: Dict[str, Tool] = {}
        for t in tools or []:
            self.register(t)

    def register(self, tool: Tool) -> None:
        if not tool.name:
            raise ValueError("Tool must define a non-empty name")
        if tool.name in self._tools:
            raise ValueError(f"Duplicate tool name: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def specs(self) -> List[ToolSpec]:
        return [t.spec() for t in self._tools.values()]

    def names(self) -> List[str]:
        return list(self._tools.keys())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _oid(v: Optional[str]) -> Optional[ObjectId]:
    if not v:
        return None
    try:
        return ObjectId(v)
    except Exception:
        return None


def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return doc
    out = dict(doc)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    for k, v in list(out.items()):
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
    out.pop("password_hash", None)
    return out


def _summarize_report(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r.get("id") or str(r.get("_id", "")),
        "title": r.get("title"),
        "activity_type": r.get("activity_type"),
        "status": r.get("status"),
        "status_label": STATUS_LABELS.get(r.get("status", ""), r.get("status", "")),
        "created_by_name": r.get("created_by_name"),
        "created_at": r.get("created_at"),
        "date_of_activity": r.get("date_of_activity"),
    }


# ---------------------------------------------------------------------------
# Identity / context tools
# ---------------------------------------------------------------------------

class WhoAmITool(Tool):
    name = "whoami"
    description = (
        "Return the currently logged-in user's identity, role, department, "
        "and committee memberships. Use this whenever you need to reason "
        "about what the user can see or do."
    )
    parameters = {"type": "object", "properties": {}}

    async def run(self, args, user, db):
        return ToolResult.success({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "role_label": {
                "admin": "Principal / Administrator",
                "coordinator": "IQAC Coordinator",
                "hod": "Head of Department",
                "staff": "Faculty / Staff",
            }.get(user.role, user.role),
            "department_id": user.department_id,
            "department_name": user.department_name,
            "committee_codes": user.committee_codes,
            "can_manage_exam_timetable": user.can_manage_exam_timetable,
            "can_see_all_reports": user.can_see_all_reports,
        })


class GetCurrentDateTool(Tool):
    name = "get_current_date"
    description = "Return today's date and the current academic-year hint (IST)."
    parameters = {"type": "object", "properties": {}}

    async def run(self, args, user, db):
        now = datetime.now(timezone.utc)
        # Academic year: Jul YYYY – Jun (YYYY+1)
        ay_start = now.year if now.month >= 7 else now.year - 1
        return ToolResult.success({
            "iso": now.isoformat(),
            "date": now.date().isoformat(),
            "academic_year": f"{ay_start}-{ay_start + 1}",
        })


# ---------------------------------------------------------------------------
# Reports (IQAC Sheets)
# ---------------------------------------------------------------------------

class ListReportsTool(Tool):
    name = "list_reports"
    description = (
        "List IQAC activity reports the user is allowed to see. "
        "Optionally filter by status, activity_type, or a free-text query "
        "against title/venue/faculty/topic. Results are already scoped by "
        "the caller's role (staff only see their own drafts + approved "
        "reports; HODs see their department; admin/coordinator see all)."
    )
    parameters = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "description": "Optional status filter (draft, submitted, approved, ...)."},
            "activity_type": {"type": "string"},
            "q": {"type": "string", "description": "Free-text search."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 25},
            "mine_only": {"type": "boolean", "description": "Force scope to only the caller's own reports."},
        },
    }

    async def run(self, args, user, db):
        extra: Dict[str, Any] = {}
        if args.get("status"):
            extra["status"] = args["status"]
        if args.get("activity_type"):
            extra["activity_type"] = args["activity_type"]
        if args.get("q"):
            q = args["q"]
            extra["$or"] = [
                {"title": {"$regex": q, "$options": "i"}},
                {"venue": {"$regex": q, "$options": "i"}},
                {"faculty": {"$regex": q, "$options": "i"}},
                {"topic": {"$regex": q, "$options": "i"}},
            ]
        query = scope_reports_query(user, extra)
        if args.get("mine_only"):
            query["created_by"] = user.id
        limit = int(args.get("limit") or 25)
        docs = await db.reports.find(query).sort("created_at", -1).to_list(limit)
        items = [_summarize_report(_serialize(d)) for d in docs]
        return ToolResult.success({"count": len(items), "items": items})


class CountReportsTool(Tool):
    name = "count_reports"
    description = (
        "Count IQAC reports the user is allowed to see, optionally grouped "
        "by status. Useful for questions like 'how many reports have I "
        "created?' or 'how many are pending review?'."
    )
    parameters = {
        "type": "object",
        "properties": {
            "mine_only": {"type": "boolean", "default": False},
            "group_by_status": {"type": "boolean", "default": True},
        },
    }

    async def run(self, args, user, db):
        query = scope_reports_query(user)
        if args.get("mine_only"):
            query["created_by"] = user.id
        total = await db.reports.count_documents(query)
        out: Dict[str, Any] = {"total": total}
        if args.get("group_by_status", True):
            groups: Dict[str, int] = {}
            for status in ("draft", "submitted", "under_review", "approved", "rejected", "revision_requested"):
                groups[status] = await db.reports.count_documents({**query, "status": status})
            out["by_status"] = groups
        return ToolResult.success(out)


class GetReportTool(Tool):
    name = "get_report"
    description = "Fetch full details of one IQAC report by id (RBAC-checked)."
    parameters = {
        "type": "object",
        "properties": {"report_id": {"type": "string"}},
        "required": ["report_id"],
    }

    async def run(self, args, user, db):
        oid = _oid(args.get("report_id"))
        if not oid:
            return ToolResult.failure("Invalid report id.")
        doc = await db.reports.find_one({"_id": oid})
        if not doc:
            return ToolResult.failure("Report not found.")
        # RBAC re-check
        from .rbac import can_view_report  # local import avoids cycles
        if not can_view_report(user, _serialize(doc)):
            return ToolResult.failure("You do not have permission to view this report.")
        return ToolResult.success(_serialize(doc))


# ---------------------------------------------------------------------------
# Notices / Announcements
# ---------------------------------------------------------------------------

class ListNoticesTool(Tool):
    name = "list_notices"
    description = "List recent notices (all authenticated users can read notices)."
    parameters = {
        "type": "object",
        "properties": {
            "q": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            "mine_only": {"type": "boolean"},
        },
    }

    async def run(self, args, user, db):
        query: Dict[str, Any] = {}
        if args.get("q"):
            q = args["q"]
            query["$or"] = [
                {"title": {"$regex": q, "$options": "i"}},
                {"body": {"$regex": q, "$options": "i"}},
                {"department": {"$regex": q, "$options": "i"}},
            ]
        if args.get("mine_only"):
            query["created_by"] = user.id
        limit = int(args.get("limit") or 25)
        docs = await db.notices.find(query).sort("created_at", -1).to_list(limit)
        items = [{
            "id": str(d["_id"]),
            "title": d.get("title"),
            "date": d.get("date"),
            "department": d.get("department"),
            "audience": d.get("audience"),
            "created_by_name": d.get("created_by_name"),
            "created_at": d.get("created_at"),
        } for d in docs]
        return ToolResult.success({"count": len(items), "items": items})


class ListAnnouncementsTool(Tool):
    name = "list_announcements"
    description = "List recent announcements (institute-wide + department)."
    parameters = {
        "type": "object",
        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
    }

    async def run(self, args, user, db):
        limit = int(args.get("limit") or 20)
        docs = await db.announcements.find({}).sort("created_at", -1).to_list(limit)
        items = [{
            "id": str(d["_id"]),
            "title": d.get("title"),
            "priority": d.get("priority"),
            "created_by_name": d.get("created_by_name"),
            "created_at": d.get("created_at"),
            "body_preview": (d.get("body") or "")[:200],
        } for d in docs]
        return ToolResult.success({"count": len(items), "items": items})


# ---------------------------------------------------------------------------
# Timetables + Committees + Departments
# ---------------------------------------------------------------------------

class ListTimetablesTool(Tool):
    name = "list_timetables"
    description = "List exam or daily time tables."
    parameters = {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": ["exam", "daily"], "default": "exam"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
        },
    }

    async def run(self, args, user, db):
        tt_type = args.get("type") or "exam"
        query: Dict[str, Any] = {}
        if tt_type == "exam":
            query["$or"] = [{"type": "exam"}, {"type": {"$exists": False}}]
        else:
            query["type"] = tt_type
        limit = int(args.get("limit") or 25)
        docs = await db.timetables.find(query).sort("created_at", -1).to_list(limit)
        items = [{
            "id": str(d["_id"]),
            "type": d.get("type") or "exam",
            "title": d.get("title"),
            "class_name": d.get("class_name"),
            "semester": d.get("semester"),
            "date_issued": d.get("date_issued"),
            "created_at": d.get("created_at"),
        } for d in docs]
        return ToolResult.success({"count": len(items), "items": items})


class ListCommitteesTool(Tool):
    name = "list_committees"
    description = "List all committees with member counts (read-only)."
    parameters = {"type": "object", "properties": {}}

    async def run(self, args, user, db):
        docs = await db.committees.find({}).sort("name", 1).to_list(200)
        items = [{
            "id": str(d["_id"]),
            "name": d.get("name"),
            "code": d.get("code"),
            "active": d.get("active", True),
            "member_count": len(d.get("members") or []),
            "is_member": user.id in (d.get("members") or []),
        } for d in docs]
        return ToolResult.success({"count": len(items), "items": items})


class ListDepartmentsTool(Tool):
    name = "list_departments"
    description = "List all departments (read-only, all users)."
    parameters = {"type": "object", "properties": {}}

    async def run(self, args, user, db):
        docs = await db.departments.find({}).sort("name", 1).to_list(200)
        items = [{
            "id": str(d["_id"]),
            "name": d.get("name"),
            "code": d.get("code"),
        } for d in docs]
        return ToolResult.success({"count": len(items), "items": items})


# ---------------------------------------------------------------------------
# Stats / dashboard
# ---------------------------------------------------------------------------

class StatsOverviewTool(Tool):
    name = "stats_overview"
    description = (
        "Dashboard-style statistics for the user (scoped by role). Returns "
        "totals by status, by activity type, and per-department for privileged roles."
    )
    parameters = {"type": "object", "properties": {}}

    async def run(self, args, user, db):
        base = scope_reports_query(user)
        total = await db.reports.count_documents(base)
        by_status = {}
        for s in ("draft", "submitted", "under_review", "approved", "rejected", "revision_requested"):
            by_status[s] = await db.reports.count_documents({**base, "status": s})
        by_type = {}
        for t in ("Curricular", "Co-Curricular", "Extra-Curricular", "Extension", "Society-based", "Commemorative Days"):
            by_type[t] = await db.reports.count_documents({**base, "activity_type": t})
        pending = by_status["submitted"] + by_status["under_review"] + by_status["revision_requested"]
        return ToolResult.success({
            "total": total,
            "pending": pending,
            "approved": by_status["approved"],
            "rejected": by_status["rejected"],
            "by_status": by_status,
            "by_type": by_type,
        })


# ---------------------------------------------------------------------------
# Live form-fill draft tools — return FormFillPlan objects
# ---------------------------------------------------------------------------

def _plan(form_id: str, route: str, intent: str, fields: List[Dict[str, Any]]) -> FormFillPlan:
    return FormFillPlan(
        form_id=form_id,
        route=route,
        intent=intent,
        fields=[FormFillField(**f) for f in fields],
    )


class PrepareReportDraftTool(Tool):
    name = "prepare_report_draft"
    description = (
        "Prepare a live-fill plan for the New IQAC Report form (/reports/new). "
        "The frontend will open the form and type each field one by one with "
        "visible progress. Never saves — the user reviews and clicks Save."
    )
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "activity_type": {
                "type": "string",
                "enum": ["Curricular", "Co-Curricular", "Extra-Curricular", "Extension", "Society-based", "Commemorative Days"],
            },
            "date_of_activity": {"type": "string", "description": "YYYY-MM-DD"},
            "date_of_proposal": {"type": "string", "description": "YYYY-MM-DD"},
            "time": {"type": "string"},
            "venue": {"type": "string"},
            "faculty": {"type": "string"},
            "no_of_participants": {"type": "integer"},
            "activity_for": {"type": "string"},
            "coordinator_name": {"type": "string"},
            "coordinator_phone": {"type": "string"},
            "members": {"type": "string"},
            "invited_guest": {"type": "string"},
            "brief": {"type": "string"},
            "topic": {"type": "string"},
            "objectives": {"type": "string"},
            "methodology": {"type": "string"},
            "outcomes": {"type": "string"},
        },
        "required": ["title", "activity_type"],
    }

    _FIELD_MAP = [
        # (arg_name, selector data-testid, label, strategy)
        ("title", "report-title", "Title of the Activity", "text"),
        ("activity_type", "report-activity-type", "Activity Type", "select"),
        ("date_of_proposal", "report-date-proposal", "Date of Proposal", "text"),
        ("date_of_activity", "report-date-activity", "Date of Activity", "text"),
        ("time", "report-time", "Time", "text"),
        ("venue", "report-venue", "Venue", "text"),
        ("faculty", "report-faculty", "Faculty", "text"),
        ("no_of_participants", "report-participants", "No. of Participants", "text"),
        ("activity_for", "report-activity-for", "Activity For", "text"),
        ("coordinator_name", "report-coord-name", "Coordinator Name", "text"),
        ("coordinator_phone", "report-coord-phone", "Coordinator Phone", "text"),
        ("members", "report-members", "Members / Support", "text"),
        ("invited_guest", "report-guest", "Invited Guest", "text"),
        ("brief", "report-brief", "Brief Information", "text"),
        ("topic", "report-topic", "Topic / Subject", "text"),
        ("objectives", "report-objectives", "Objectives", "text"),
        ("methodology", "report-methodology", "Methodology", "text"),
        ("outcomes", "report-outcomes", "Outcomes", "text"),
    ]

    async def run(self, args, user, db):
        fields = []
        for arg_name, testid, label, strategy in self._FIELD_MAP:
            value = args.get(arg_name)
            if value in (None, ""):
                continue
            fields.append({
                "selector": f'[data-testid="{testid}"]',
                "label": label,
                "value": value,
                "strategy": strategy,
            })
        if not fields:
            return ToolResult.failure("No fields to fill — please provide at least a title.")
        plan = _plan(
            form_id="report_form",
            route="/reports/new",
            intent=f"Drafting IQAC report: {args.get('title') or ''}",
            fields=fields,
        )
        return ToolResult.success(
            plan.model_dump(),
            ui_hint={"action": "form_fill", "form_id": "report_form"},
        )


class PrepareNoticeDraftTool(Tool):
    name = "prepare_notice_draft"
    description = "Prepare a live-fill plan for the New Notice form (/notices/new)."
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "date": {"type": "string", "description": "YYYY-MM-DD"},
            "department": {"type": "string"},
            "audience": {"type": "string"},
            "body": {"type": "string"},
            "activity_name": {"type": "string"},
            "activity_date": {"type": "string"},
            "activity_time": {"type": "string"},
            "venue": {"type": "string"},
            "subject": {"type": "string"},
            "proposal_body": {"type": "string"},
            "budget": {"type": "string"},
        },
        "required": ["title", "body"],
    }

    _MAP = [
        ("title", "notice-title", "Title", "text"),
        ("date", "notice-date", "Date", "text"),
        ("department", "notice-department", "Department", "text"),
        ("audience", "notice-audience", "Audience", "text"),
        ("body", "notice-body", "Body", "text"),
        ("activity_name", "notice-activity-name", "Activity Name", "text"),
        ("activity_date", "notice-activity-date", "Activity Date", "text"),
        ("activity_time", "notice-activity-time", "Activity Time", "text"),
        ("venue", "notice-venue", "Venue", "text"),
        ("subject", "notice-subject", "Subject", "text"),
        ("proposal_body", "notice-proposal", "Proposal Body", "text"),
        ("budget", "notice-budget", "Budget", "text"),
    ]

    async def run(self, args, user, db):
        fields = []
        for arg, testid, label, strategy in self._MAP:
            v = args.get(arg)
            if v in (None, ""):
                continue
            fields.append({
                "selector": f'[data-testid="{testid}"]',
                "label": label,
                "value": v,
                "strategy": strategy,
            })
        if not fields:
            return ToolResult.failure("Need at least a title and body.")
        plan = _plan(
            form_id="notice_form",
            route="/notices/new",
            intent=f"Drafting notice: {args.get('title')}",
            fields=fields,
        )
        return ToolResult.success(plan.model_dump(), ui_hint={"action": "form_fill", "form_id": "notice_form"})


class PrepareAnnouncementDraftTool(Tool):
    name = "prepare_announcement_draft"
    description = "Prepare a live-fill plan for the New Announcement form."
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "body": {"type": "string"},
            "priority": {"type": "string", "enum": ["normal", "important", "emergency"], "default": "normal"},
        },
        "required": ["title", "body"],
    }

    async def run(self, args, user, db):
        fields = [
            {"selector": '[data-testid="ann-title"]', "label": "Title", "value": args["title"], "strategy": "text"},
            {"selector": '[data-testid="ann-body"]', "label": "Body", "value": args["body"], "strategy": "text"},
            {"selector": '[data-testid="ann-priority"]', "label": "Priority",
             "value": args.get("priority") or "normal", "strategy": "select"},
        ]
        plan = _plan(
            form_id="announcement_form",
            route="/announcements",
            intent=f"Drafting announcement: {args['title']}",
            fields=fields,
        )
        return ToolResult.success(plan.model_dump(), ui_hint={"action": "form_fill", "form_id": "announcement_form"})


class PrepareExamTimetableDraftTool(Tool):
    name = "prepare_exam_timetable_draft"
    description = (
        "Prepare a live-fill plan for a new Exam Time Table. RBAC-checked: "
        "only Admin, IQAC Coordinator, or Exam Committee members are allowed."
    )
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "class_name": {"type": "string"},
            "semester": {"type": "string"},
            "date_issued": {"type": "string", "description": "YYYY-MM-DD"},
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "day_date": {"type": "string"},
                        "time": {"type": "string"},
                        "subject": {"type": "string"},
                    },
                    "required": ["day_date", "time", "subject"],
                },
            },
        },
        "required": ["title", "class_name"],
    }

    async def run(self, args, user, db):
        if not can_manage_exam_timetable(user):
            return ToolResult.failure(REFUSAL_EXAM_RBAC)
        fields: List[Dict[str, Any]] = [
            {"selector": '[data-testid="tt-title"]', "label": "Title", "value": args["title"], "strategy": "text"},
            {"selector": '[data-testid="tt-class"]', "label": "Class", "value": args["class_name"], "strategy": "text"},
        ]
        if args.get("semester"):
            fields.append({"selector": '[data-testid="tt-semester"]', "label": "Semester",
                           "value": args["semester"], "strategy": "text"})
        if args.get("date_issued"):
            fields.append({"selector": '[data-testid="tt-date"]', "label": "Date Issued",
                           "value": args["date_issued"], "strategy": "text"})
        entries = args.get("entries") or []
        for i, e in enumerate(entries):
            fields.append({
                "selector": f'[data-testid="tt-entry-{i}"]',
                "label": f"Entry {i + 1}",
                "value": e,
                "strategy": "text",
            })
        plan = _plan(
            form_id="exam_timetable_form",
            route="/timetables/new",
            intent=f"Drafting Exam Time Table: {args['title']}",
            fields=fields,
        )
        return ToolResult.success(plan.model_dump(), ui_hint={"action": "form_fill", "form_id": "exam_timetable_form"})


# ---------------------------------------------------------------------------
# Explicit refusal tools — the model may still try; refuse politely.
# ---------------------------------------------------------------------------

class AdminOnlyRefusalTool(Tool):
    """Sentinel tool the agent can call to explain why it refuses."""
    name = "explain_refusal"
    description = (
        "Return a polite explanation that the requested action requires "
        "administrator privileges the agent does not exercise (managing "
        "users, departments, committees, roles, passwords, system settings, "
        "or database schema)."
    )
    parameters = {"type": "object", "properties": {"topic": {"type": "string"}}}

    async def run(self, args, user, db):
        return ToolResult.success({"message": REFUSAL_ADMIN_ONLY, "topic": args.get("topic")})


# ---------------------------------------------------------------------------
# Default registry
# ---------------------------------------------------------------------------

def build_default_registry() -> ToolRegistry:
    return ToolRegistry([
        WhoAmITool(),
        GetCurrentDateTool(),
        ListReportsTool(),
        CountReportsTool(),
        GetReportTool(),
        ListNoticesTool(),
        ListAnnouncementsTool(),
        ListTimetablesTool(),
        ListCommitteesTool(),
        ListDepartmentsTool(),
        StatsOverviewTool(),
        PrepareReportDraftTool(),
        PrepareNoticeDraftTool(),
        PrepareAnnouncementDraftTool(),
        PrepareExamTimetableDraftTool(),
        AdminOnlyRefusalTool(),
    ])


__all__ = [
    "Tool",
    "ToolRegistry",
    "build_default_registry",
]
