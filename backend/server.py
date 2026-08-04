from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
import aiofiles
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image as RLImage
)
from reportlab.pdfgen import canvas as rl_canvas

# -----------------------------------------------------------------------------
# Config & globals
# -----------------------------------------------------------------------------
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60 * 8       # 8 hours for academic portal convenience
REFRESH_TTL_DAYS = 7
BASE_DIR = Path(__file__).resolve().parent

UPLOAD_DIR = Path(
    os.environ.get(
        "UPLOAD_DIR",
        str(BASE_DIR / "uploads")
    )
)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.getenv(
    "MONGO_URL",
    "mongodb+srv://khaamkarfurquan4busy_db_user:6gsK5y6cQMJrh6K4@cluster1.pbrox60.mongodb.net/?appName=Cluster1",
)

client = AsyncIOMotorClient(
    MONGO_URL,
    serverSelectionTimeoutMS=15000,
    tlsAllowInvalidCertificates=True,
)

db = client["IQAC1"]   # Replace "iqac" with your database name

ROLES = ("admin", "coordinator", "hod", "staff")
STATUSES = ("draft", "submitted", "under_review", "approved", "rejected", "revision_requested")
ACTIVITY_TYPES = (
    "Curricular", "Co-Curricular", "Extra-Curricular",
    "Extension", "Society-based", "Commemorative Days",
)
PROOF_CATEGORIES = (
    "proposal", "notice", "timetable", "invitation", "attendance",
    "event_report", "feedback", "news", "reels", "certificate", "other",
)

# -----------------------------------------------------------------------------
# App & router
# -----------------------------------------------------------------------------
app = FastAPI(title="IQAC Portal — Ramsheth Thakur College")
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# -----------------------------------------------------------------------------
# Helpers — passwords, tokens, oid
# -----------------------------------------------------------------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def _now() -> datetime:
    return datetime.now(timezone.utc)

def create_access_token(uid: str, email: str, role: str) -> str:
    payload = {
        "sub": uid, "email": email, "role": role,
        "exp": _now() + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return jwt.encode(payload, os.environ.get("JWT_SECRET", "dev-secret-change-me"), algorithm=JWT_ALG)

def create_refresh_token(uid: str) -> str:
    payload = {"sub": uid, "exp": _now() + timedelta(days=REFRESH_TTL_DAYS), "type": "refresh"}
    return jwt.encode(payload, os.environ.get("JWT_SECRET", "dev-secret-change-me"), algorithm=JWT_ALG)

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False,
                        samesite="lax", max_age=ACCESS_TTL_MIN * 60, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False,
                        samesite="lax", max_age=REFRESH_TTL_DAYS * 86400, path="/")

def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

def to_oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")

def serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    for k, v in list(doc.items()):
        if isinstance(v, ObjectId):
            doc[k] = str(v)
        elif isinstance(v, datetime):
            doc[k] = v.isoformat()
    doc.pop("password_hash", None)
    return doc


# -----------------------------------------------------------------------------
# Auth dependency
# -----------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, os.environ.get("JWT_SECRET", "dev-secret-change-me"), algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_roles(*roles):
    async def _dep(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Forbidden — insufficient privileges")
        return user
    return _dep


# -----------------------------------------------------------------------------
# Audit log helper
# -----------------------------------------------------------------------------
async def audit(user: dict, action: str, target: str = "", details: str = ""):
    await db.audit_logs.insert_one({
        "actor_id": str(user["_id"]),
        "actor_email": user.get("email"),
        "actor_role": user.get("role"),
        "action": action,
        "target": target,
        "details": details,
        "created_at": _now().isoformat(),
    })


# -----------------------------------------------------------------------------
# Pydantic models
# -----------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["admin", "coordinator", "hod", "staff"]
    department_id: Optional[str] = None
    phone: Optional[str] = None
    committee_ids: Optional[List[str]] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["admin", "coordinator", "hod", "staff"]] = None
    department_id: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None
    committee_ids: Optional[List[str]] = None

class DepartmentCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None

class CommitteeCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    active: bool = True

class CommitteeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None

class CommitteeMembers(BaseModel):
    user_ids: List[str]

class ProofFile(BaseModel):
    category: str
    filename: str
    url: str
    size: int
    uploaded_at: str

class ReportCreate(BaseModel):
    activity_number: Optional[str] = None
    activity_schedule_number: Optional[str] = None
    activity_type: str
    title: str
    date_of_proposal: Optional[str] = None
    date_of_activity: Optional[str] = None
    time: Optional[str] = None
    faculty: Optional[str] = None
    department_id: Optional[str] = None
    committee: Optional[str] = None
    venue: Optional[str] = None
    no_of_participants: Optional[int] = 0
    activity_for: Optional[str] = None
    coordinator_name: Optional[str] = None
    coordinator_phone: Optional[str] = None
    members: Optional[str] = None
    invited_guest: Optional[str] = None
    brief: Optional[str] = None
    topic: Optional[str] = None
    objectives: Optional[str] = None
    methodology: Optional[str] = None
    outcomes: Optional[str] = None

class ReportUpdate(ReportCreate):
    activity_type: Optional[str] = None
    title: Optional[str] = None

class WorkflowAction(BaseModel):
    action: Literal["submit", "approve", "reject", "request_revision"]
    note: Optional[str] = None

class AnnouncementCreate(BaseModel):
    title: str
    body: str
    priority: Literal["normal", "important", "emergency"] = "normal"
    department_id: Optional[str] = None  # null = institute-wide


class NoticeCreate(BaseModel):
    title: str
    date: Optional[str] = None            # date the notice is issued
    department: Optional[str] = None       # e.g. Department of Computer Science
    audience: Optional[str] = None         # e.g. TYBSc CS
    body: str                              # main notice body text
    # Optional event details (mirrors the reference Notice.docx)
    activity_name: Optional[str] = None
    activity_date: Optional[str] = None
    activity_time: Optional[str] = None
    venue: Optional[str] = None
    subject: Optional[str] = None          # for the "Proposal" section
    proposal_body: Optional[str] = None    # optional proposal to Principal
    budget: Optional[str] = None

class NoticeUpdate(NoticeCreate):
    title: Optional[str] = None
    body: Optional[str] = None


class TimetableEntry(BaseModel):
    day_date: str
    time: str
    subject: str

class DailyCellEntry(BaseModel):
    subject: str = ""
    batch: str = ""
    room: str = ""
    faculty: str = ""

class DailyRow(BaseModel):
    time_slot: str = ""
    monday: List[DailyCellEntry] = []
    tuesday: List[DailyCellEntry] = []
    wednesday: List[DailyCellEntry] = []
    thursday: List[DailyCellEntry] = []
    friday: List[DailyCellEntry] = []
    saturday: List[DailyCellEntry] = []

class TimetableCreate(BaseModel):
    type: Literal["exam", "daily"] = "exam"
    title: str                             # e.g. "External Regular Examination Timetable March 2026"
    class_name: str                        # e.g. "FY BSc CS" or "T.Y.B.Sc.CS"
    semester: Optional[str] = None
    committee: Optional[str] = "Examination Committee"
    date_issued: Optional[str] = None
    entries: List[TimetableEntry] = []      # exam type only
    department: Optional[str] = None        # daily type only
    academic_year: Optional[str] = None      # daily type only
    daily_rows: List[DailyRow] = []          # daily type only

class TimetableUpdate(BaseModel):
    type: Optional[Literal["exam", "daily"]] = None
    title: Optional[str] = None
    class_name: Optional[str] = None
    semester: Optional[str] = None
    committee: Optional[str] = None
    date_issued: Optional[str] = None
    entries: Optional[List[TimetableEntry]] = None
    department: Optional[str] = None
    academic_year: Optional[str] = None
    daily_rows: Optional[List[DailyRow]] = None


class FooterSignature(BaseModel):
    label: str
    name: str = ""
    role: str = ""

class FooterSettings(BaseModel):
    signatures: List[FooterSignature]


# -----------------------------------------------------------------------------
# Startup — indexes & admin seed
# -----------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.reports.create_index([("status", 1), ("department_id", 1)])
    await db.reports.create_index("created_at")
    await db.audit_logs.create_index("created_at")
    await db.announcements.create_index("created_at")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "name": "Principal",
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "department_id": None,
            "phone": None,
            "created_at": _now().isoformat(),
        })
        logger.info("Seeded admin user %s", admin_email)
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )
        logger.info("Updated admin password for %s", admin_email)

    # Seed the "Exam" department used for Exam Time Table RBAC
    if not await db.departments.find_one({"name": "Exam"}):
        await db.departments.insert_one({
            "name": "Exam",
            "code": "EXAM",
            "description": "Examination Committee — manages Exam Time Tables.",
            "created_at": _now().isoformat(),
        })
        logger.info("Seeded 'Exam' department")

    # Seed default committees (idempotent — only inserts missing ones)
    default_committees = [
        ("Exam", "EXAM", "Examination Committee — manages Exam Time Tables"),
        ("IQAC", "IQAC", "Internal Quality Assurance Cell"),
        ("NSS", "NSS", "National Service Scheme"),
        ("Cultural", "CULTURAL", "Cultural Committee"),
        ("Sports", "SPORTS", "Sports Committee"),
        ("Placement", "PLACEMENT", "Placement Committee"),
    ]
    await db.committees.create_index("code", unique=True)
    for name, code, description in default_committees:
        if not await db.committees.find_one({"code": code}):
            await db.committees.insert_one({
                "name": name,
                "code": code,
                "description": description,
                "active": True,
                "members": [],
                "created_at": _now().isoformat(),
            })
            logger.info("Seeded committee: %s", name)


@app.on_event("shutdown")
async def shutdown():
    client.close()


# =============================================================================
# AUTH
# =============================================================================
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    user = await db.users.find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(str(user["_id"]), user["email"], user["role"])
    refresh = create_refresh_token(str(user["_id"]))
    set_auth_cookies(response, access, refresh)
    await audit(user, "login", target=user["email"])
    return serialize(user)

@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    clear_auth_cookies(response)
    await audit(user, "logout")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return serialize(user)


# =============================================================================
# USERS (admin manages everyone; others read limited)
# =============================================================================
@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    # Admin & coordinator see all; HOD sees their dept; staff sees self
    q = {}
    if user["role"] == "hod":
        q = {"department_id": user.get("department_id")}
    elif user["role"] == "staff":
        q = {"_id": user["_id"]}
    docs = await db.users.find(q).sort("created_at", -1).to_list(1000)
    return [serialize(d) for d in docs]

@api.post("/users")
async def create_user(payload: UserCreate, user: dict = Depends(require_roles("admin", "coordinator"))):
    if await db.users.find_one({"email": payload.email.lower()}):
        raise HTTPException(status_code=400, detail="Email already exists")
    committee_ids = payload.committee_ids or []
    doc = {
        "name": payload.name,
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "role": payload.role,
        "department_id": payload.department_id,
        "phone": payload.phone,
        "committee_ids": committee_ids,
        "created_at": _now().isoformat(),
    }
    res = await db.users.insert_one(doc)
    uid_str = str(res.inserted_id)
    # Sync membership onto each committee's members list
    if committee_ids:
        await db.committees.update_many(
            {"_id": {"$in": [to_oid(cid) for cid in committee_ids]}},
            {"$addToSet": {"members": uid_str}},
        )
    doc["_id"] = res.inserted_id
    await audit(user, "user.create", target=payload.email,
                details=f"role={payload.role},committees={len(committee_ids)}")
    return serialize(doc)

@api.put("/users/{uid}")
async def update_user(uid: str, payload: UserUpdate, user: dict = Depends(require_roles("admin", "coordinator"))):
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "password" in upd:
        upd["password_hash"] = hash_password(upd.pop("password"))
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    # If committee_ids provided, sync committees.members bidirectionally
    if "committee_ids" in upd:
        new_ids = set(upd["committee_ids"] or [])
        existing = await db.users.find_one({"_id": to_oid(uid)}, {"committee_ids": 1})
        old_ids = set(existing.get("committee_ids") or []) if existing else set()
        to_add = new_ids - old_ids
        to_remove = old_ids - new_ids
        if to_add:
            await db.committees.update_many(
                {"_id": {"$in": [to_oid(cid) for cid in to_add]}},
                {"$addToSet": {"members": uid}},
            )
        if to_remove:
            await db.committees.update_many(
                {"_id": {"$in": [to_oid(cid) for cid in to_remove]}},
                {"$pull": {"members": uid}},
            )
    await db.users.update_one({"_id": to_oid(uid)}, {"$set": upd})
    doc = await db.users.find_one({"_id": to_oid(uid)})
    await audit(user, "user.update", target=uid, details=",".join(upd.keys()))
    return serialize(doc)

@api.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_roles("admin"))):
    if str(user["_id"]) == uid:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.users.delete_one({"_id": to_oid(uid)})
    # Purge from all committees.members
    await db.committees.update_many({}, {"$pull": {"members": uid}})
    await audit(user, "user.delete", target=uid)
    return {"ok": True}








    


# =============================================================================
# DEPARTMENTS
# =============================================================================
@api.get("/departments")
async def list_departments(user: dict = Depends(get_current_user)):
    docs = await db.departments.find({}).sort("name", 1).to_list(500)
    return [serialize(d) for d in docs]

@api.post("/departments")
async def create_department(payload: DepartmentCreate, user: dict = Depends(require_roles("admin"))):
    if await db.departments.find_one({"code": payload.code}):
        raise HTTPException(status_code=400, detail="Department code already exists")
    doc = payload.model_dump()
    doc["created_at"] = _now().isoformat()
    res = await db.departments.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "department.create", target=payload.code)
    return serialize(doc)

@api.put("/departments/{did}")
async def update_department(did: str, payload: DepartmentUpdate, user: dict = Depends(require_roles("admin"))):
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.departments.update_one({"_id": to_oid(did)}, {"$set": upd})
    doc = await db.departments.find_one({"_id": to_oid(did)})
    await audit(user, "department.update", target=did)
    return serialize(doc)

@api.delete("/departments/{did}")
async def delete_department(did: str, user: dict = Depends(require_roles("admin"))):
    await db.departments.delete_one({"_id": to_oid(did)})
    await audit(user, "department.delete", target=did)
    return {"ok": True}


# =============================================================================
# COMMITTEES — generic committee module (Exam, IQAC, NSS, Cultural, Sports,
# Placement, and any new committees an Admin creates in the future).
# Membership never changes a user's Department; a user may belong to multiple
# committees. Only the Exam Committee membership + Admin + IQAC Coordinator
# grants Exam-Timetable management privileges (strict RBAC below).
# =============================================================================
@api.get("/committees")
async def list_committees(user: dict = Depends(get_current_user)):
    docs = await db.committees.find({}).sort("name", 1).to_list(500)
    return [serialize(d) for d in docs]

@api.get("/committees/{cid}")
async def get_committee(cid: str, user: dict = Depends(get_current_user)):
    doc = await db.committees.find_one({"_id": to_oid(cid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Committee not found")
    return serialize(doc)

@api.post("/committees")
async def create_committee(payload: CommitteeCreate, user: dict = Depends(require_roles("admin"))):
    if await db.committees.find_one({"code": payload.code.upper()}):
        raise HTTPException(status_code=400, detail="Committee code already exists")
    doc = payload.model_dump()
    doc["code"] = doc["code"].upper()
    doc["members"] = []
    doc["created_at"] = _now().isoformat()
    res = await db.committees.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "committee.create", target=payload.code, details=payload.name)
    return serialize(doc)

@api.put("/committees/{cid}")
async def update_committee(cid: str, payload: CommitteeUpdate, user: dict = Depends(require_roles("admin"))):
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "code" in upd:
        upd["code"] = upd["code"].upper()
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.committees.update_one({"_id": to_oid(cid)}, {"$set": upd})
    doc = await db.committees.find_one({"_id": to_oid(cid)})
    await audit(user, "committee.update", target=cid, details=",".join(upd.keys()))
    return serialize(doc)

@api.patch("/committees/{cid}/toggle-active")
async def toggle_committee_active(cid: str, user: dict = Depends(require_roles("admin"))):
    doc = await db.committees.find_one({"_id": to_oid(cid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Committee not found")
    new_state = not bool(doc.get("active", True))
    await db.committees.update_one({"_id": to_oid(cid)}, {"$set": {"active": new_state}})
    doc = await db.committees.find_one({"_id": to_oid(cid)})
    await audit(user, "committee.toggle", target=cid, details=f"active={new_state}")
    return serialize(doc)

@api.delete("/committees/{cid}")
async def delete_committee(cid: str, user: dict = Depends(require_roles("admin"))):
    doc = await db.committees.find_one({"_id": to_oid(cid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Committee not found")
    # Purge the committee id from every user's committee_ids list
    await db.users.update_many({}, {"$pull": {"committee_ids": cid}})
    await db.committees.delete_one({"_id": to_oid(cid)})
    await audit(user, "committee.delete", target=cid, details=doc.get("name", ""))
    return {"ok": True}

@api.put("/committees/{cid}/members")
async def set_committee_members(cid: str, payload: CommitteeMembers, user: dict = Depends(require_roles("admin"))):
    """Replace the full member list of a committee. Membership never changes the
    user's Department — it only affects committee-scoped permissions."""
    committee = await db.committees.find_one({"_id": to_oid(cid)})
    if not committee:
        raise HTTPException(status_code=404, detail="Committee not found")
    new_ids = list({uid for uid in payload.user_ids})
    # Validate all user ids exist
    if new_ids:
        found = await db.users.count_documents({"_id": {"$in": [to_oid(u) for u in new_ids]}})
        if found != len(new_ids):
            raise HTTPException(status_code=400, detail="One or more user ids are invalid")
    old_ids = set(committee.get("members") or [])
    added = set(new_ids) - old_ids
    removed = old_ids - set(new_ids)
    await db.committees.update_one({"_id": to_oid(cid)}, {"$set": {"members": new_ids}})
    if added:
        await db.users.update_many(
            {"_id": {"$in": [to_oid(u) for u in added]}},
            {"$addToSet": {"committee_ids": cid}},
        )
    if removed:
        await db.users.update_many(
            {"_id": {"$in": [to_oid(u) for u in removed]}},
            {"$pull": {"committee_ids": cid}},
        )
    doc = await db.committees.find_one({"_id": to_oid(cid)})
    await audit(user, "committee.members.update", target=cid,
                details=f"added={len(added)},removed={len(removed)}")
    return serialize(doc)


# =============================================================================
# REPORTS — Activity Sheet life-cycle
# =============================================================================
def _can_view_report(user: dict, report: dict) -> bool:
    role = user["role"]
    if role in ("admin", "coordinator"):
        return True
    if role == "hod":
        return report.get("department_id") == user.get("department_id")
    # staff: own reports or any approved (public archive)
    return report.get("created_by") == str(user["_id"]) or report.get("status") == "approved"

def _can_edit_report(user: dict, report: dict) -> bool:
    if user["role"] == "admin":
        return True
    if report.get("status") in ("approved",):
        return False
    if report.get("created_by") == str(user["_id"]) and report.get("status") in ("draft", "revision_requested"):
        return True
    return False

@api.get("/reports")
async def list_reports(
    status: Optional[str] = None,
    department_id: Optional[str] = None,
    activity_type: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    role = user["role"]
    query: dict = {}
    if status:
        query["status"] = status
    if department_id:
        query["department_id"] = department_id
    if activity_type:
        query["activity_type"] = activity_type
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"venue": {"$regex": q, "$options": "i"}},
            {"faculty": {"$regex": q, "$options": "i"}},
            {"topic": {"$regex": q, "$options": "i"}},
        ]

    # Role scoping
    if role == "hod":
        query["department_id"] = user.get("department_id")
    elif role == "staff":
        query["$and"] = [
            {"$or": [{"created_by": str(user["_id"])}, {"status": "approved"}]},
        ]

    docs = await db.reports.find(query).sort("created_at", -1).to_list(1000)
    return [serialize(d) for d in docs]

@api.post("/reports")
async def create_report(payload: ReportCreate, user: dict = Depends(get_current_user)):
    doc = payload.model_dump()
    # default department to user's department
    if not doc.get("department_id"):
        doc["department_id"] = user.get("department_id")
    doc.update({
        "status": "draft",
        "created_by": str(user["_id"]),
        "created_by_name": user.get("name"),
        "created_at": _now().isoformat(),
        "updated_at": _now().isoformat(),
        "proofs": [],
        "history": [{"at": _now().isoformat(), "by": user.get("email"), "action": "created"}],
    })
    res = await db.reports.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "report.create", target=str(res.inserted_id), details=payload.title)
    return serialize(doc)

@api.get("/reports/{rid}")
async def get_report(rid: str, user: dict = Depends(get_current_user)):
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    if not _can_view_report(user, doc):
        raise HTTPException(status_code=403, detail="Forbidden")
    return serialize(doc)

@api.put("/reports/{rid}")
async def update_report(rid: str, payload: ReportUpdate, user: dict = Depends(get_current_user)):
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    if not _can_edit_report(user, doc):
        raise HTTPException(status_code=403, detail="Cannot edit this report at its current state")
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = _now().isoformat()
    await db.reports.update_one({"_id": to_oid(rid)}, {"$set": upd})
    new_doc = await db.reports.find_one({"_id": to_oid(rid)})
    await audit(user, "report.update", target=rid)
    return serialize(new_doc)

@api.delete("/reports/{rid}")
async def delete_report(rid: str, user: dict = Depends(get_current_user)):
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    if user["role"] != "admin" and doc.get("created_by") != str(user["_id"]):
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.reports.delete_one({"_id": to_oid(rid)})
    await audit(user, "report.delete", target=rid)
    return {"ok": True}


# Workflow: Staff -> HOD -> Coordinator -> Admin
@api.post("/reports/{rid}/workflow")
async def workflow(rid: str, payload: WorkflowAction, user: dict = Depends(get_current_user)):
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    status = doc.get("status")
    role = user["role"]
    new_status = None

    if payload.action == "submit":
        if doc.get("created_by") != str(user["_id"]) and role != "admin":
            raise HTTPException(status_code=403, detail="Only the author can submit")
        if status not in ("draft", "revision_requested"):
            raise HTTPException(status_code=400, detail="Report cannot be submitted at this stage")
        new_status = "submitted"

    elif payload.action == "approve":
        if status == "submitted" and role in ("hod", "admin"):
            new_status = "under_review"
        elif status == "under_review" and role in ("coordinator", "admin"):
            new_status = "approved"
        elif status == "submitted" and role == "coordinator":
            new_status = "approved"
        else:
            raise HTTPException(status_code=403, detail="Cannot approve at this stage with your role")

    elif payload.action == "reject":
        if role not in ("hod", "coordinator", "admin"):
            raise HTTPException(status_code=403, detail="Not allowed")
        new_status = "rejected"

    elif payload.action == "request_revision":
        if role not in ("hod", "coordinator", "admin"):
            raise HTTPException(status_code=403, detail="Not allowed")
        new_status = "revision_requested"

    history = doc.get("history", [])
    history.append({
        "at": _now().isoformat(),
        "by": user.get("email"),
        "role": role,
        "action": payload.action,
        "from": status,
        "to": new_status,
        "note": payload.note or "",
    })
    await db.reports.update_one(
        {"_id": to_oid(rid)},
        {"$set": {"status": new_status, "updated_at": _now().isoformat(), "history": history}},
    )
    await audit(user, f"report.{payload.action}", target=rid, details=f"{status}->{new_status}")
    new_doc = await db.reports.find_one({"_id": to_oid(rid)})
    return serialize(new_doc)


# =============================================================================
# FILE UPLOADS (proofs)
# =============================================================================
@api.post("/reports/{rid}/proofs")
async def upload_proof(
    rid: str,
    category: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if category not in PROOF_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid proof category")
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    if not _can_edit_report(user, doc):
        raise HTTPException(status_code=403, detail="Cannot attach proofs at this stage")

    ext = Path(file.filename).suffix
    stored_name = f"{rid}_{category}_{uuid.uuid4().hex[:8]}{ext}"
    dest = UPLOAD_DIR / stored_name
    size = 0
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            await f.write(chunk)

    proof = {
        "category": category,
        "filename": file.filename,
        "stored": stored_name,
        "url": f"/uploads/{stored_name}",
        "size": size,
        "uploaded_at": _now().isoformat(),
        "uploaded_by": user.get("email"),
    }
    await db.reports.update_one({"_id": to_oid(rid)}, {"$push": {"proofs": proof}})
    await audit(user, "report.proof.upload", target=rid, details=category)
    return proof

@api.delete("/reports/{rid}/proofs/{stored}")
async def delete_proof(rid: str, stored: str, user: dict = Depends(get_current_user)):
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    if not _can_edit_report(user, doc):
        raise HTTPException(status_code=403, detail="Cannot remove proofs at this stage")
    await db.reports.update_one({"_id": to_oid(rid)}, {"$pull": {"proofs": {"stored": stored}}})
    fp = UPLOAD_DIR / stored
    if fp.exists():
        fp.unlink(missing_ok=True)
    await audit(user, "report.proof.delete", target=rid, details=stored)
    return {"ok": True}


# =============================================================================
# PDF EXPORT
# =============================================================================
LOGO_PATH = Path(__file__).parent / "assets" / "college-logo.png"
HEADER_BANNER_PATH = Path(__file__).parent / "assets" / "header-banner.png"

PROOF_LABELS = {
    "proposal": "Duly signed proposal",
    "notice": "Notice",
    "timetable": "Time Table / Programme",
    "invitation": "Letters of Invitation & Appreciation",
    "attendance": "Attendance list",
    "event_report": "Event Report with Geotagged photos",
    "feedback": "Feedback & Feedback Analysis",
    "news": "News",
    "reels": "Publicity link of reels",
    "certificate": "Sample Certificate",
    "other": "Any other",
}
PROOF_ORDER = [
    "proposal", "notice", "timetable", "invitation", "attendance",
    "event_report", "feedback", "news", "reels", "certificate", "other",
]


DEFAULT_FOOTER_SIGNATURES = [
    {"label": "Prepared By",     "name": "",                       "role": "Member, Gyankhana Committee"},
    {"label": "Reviewed By",     "name": "",                       "role": "Coordinator, Gyankhana Committee"},
    {"label": "Recommended By",  "name": "Mr. Prathmesh Vhatkar",  "role": "Coordinator, IQAC"},
    {"label": "Approved By",     "name": "Dr. Matsubrata Laha",    "role": "I/c Principal, RTCCS, Kharghar"},
]


async def get_footer_signatures():
    """Fetch the editable footer signature list from the settings collection."""
    doc = await db.settings.find_one({"_id": "pdf_footer"})
    if doc and isinstance(doc.get("signatures"), list) and doc["signatures"]:
        return doc["signatures"]
    return DEFAULT_FOOTER_SIGNATURES


def _draw_header_footer(c, doc, banner_text="Internal Quality Assurance Cell (IQAC)", footer_label="IQAC · Departmental Documentation"):
    """Header band + footer signatures, drawn on every page."""
    width, height = A4

# ---- HEADER ----
    top = height - 1.2 * cm

# Logo
    if LOGO_PATH.exists():
        try:
            c.drawImage(str(LOGO_PATH), 1.5 * cm, top - 2.4 * cm,
                        width=2.4 * cm, height=2.4 * cm, mask="auto")
        except Exception:
            pass

    # Institute text block — centered within the space to the RIGHT of the logo
    # (matches official letterhead layout where the logo sits at the left and
    # the institution text is centered in the remaining width).
    text_left = 4.2 * cm            # right edge of logo + small gap
    text_right = width - 1.5 * cm   # right margin
    center_x = (text_left + text_right) / 2

    c.setFillColor(colors.black)
    c.setFont("Times-Italic", 12)          # Increased from 10.5
    c.drawCentredString(center_x, top - 0.2 * cm, "Janardan Bhagat Shikshan Prasarak Sanstha's")

    # College name — maroon bold, wrapped onto two lines (matches letterhead)
    c.setFillColor(colors.HexColor("#63192B"))
    c.setFont("Times-Bold", 17)            # Increased from 15
    c.drawCentredString(center_x, top - 0.90 * cm, "RAMSHETH THAKUR COLLEGE")
    c.drawCentredString(center_x, top - 1.50 * cm, "OF COMMERCE & SCIENCE")

    c.setFillColor(colors.black)
    c.setFont("Times-Roman", 10.5)         # Increased from 9
    c.drawCentredString(center_x, top - 2.00 * cm, "Plot no-1, Sector-33, Kharghar, Navi Mumbai - 410210")
    c.drawCentredString(center_x, top - 2.40 * cm, "Affiliated to University of Mumbai")
    c.drawCentredString(center_x, top - 2.80 * cm, "Accredited 'A' Grade by NAAC with 3.xx CGPA")
    c.drawCentredString(center_x, top - 3.20 * cm, "ISO 9001:2015 & 14001:2015 Certified")

    # Bottom rule of header
    c.setStrokeColor(colors.HexColor("#63192B"))
    c.setLineWidth(1.2)
    c.line(1.5 * cm, top - 3.50 * cm, width - 1.5 * cm, top - 3.50 * cm)

    # Document-type banner (varies per document: IQAC Sheet / Notice / Exam Time Table / Daily Time Table)
    c.setFillColor(colors.HexColor("#63192B"))
    c.rect(1.5 * cm, top - 4.20 * cm, width - 3 * cm, 0.6 * cm, fill=1, stroke=0)

    c.setFillColor(colors.white)
    c.setFont("Times-Bold", 12.5)          # Increased from 11
    c.drawCentredString(width / 2, top - 4.00 * cm, banner_text)

    c.setFillColor(colors.black)

    # ---- Per-page footer (just identifier + page no) ----
    c.setFont("Times-Italic", 8)
    c.setFillColor(colors.HexColor("#5C5F62"))
    c.drawRightString(width - 1.5 * cm, 1.0 * cm, f"Page {doc.page}")
    c.drawString(1.5 * cm, 1.0 * cm, f"{footer_label} · {banner_text}")
    c.setFillColor(colors.black)


def _draw_signature_block_at_bottom(c, signatures):
    """Draw the 4-column signature block at the bottom of the current page."""
    width, _ = A4
    base_y = 2.0 * cm  # above the per-page footer line
    col_w = (width - 3 * cm) / 4

    for i, s in enumerate(signatures[:4]):
        x = 1.5 * cm + i * col_w
        # Empty line for ink signature
        c.setStrokeColor(colors.HexColor("#7a6b5a"))
        c.setLineWidth(0.5)
        c.line(x + 0.5 * cm, base_y + 1.55 * cm, x + col_w - 0.5 * cm, base_y + 1.55 * cm)
        # Role label (bold)
        c.setFillColor(colors.black)
        c.setFont("Times-Bold", 9.5)
        c.drawString(x + 0.5 * cm, base_y + 1.15 * cm, s.get("label", "") or "")
        # Name
        c.setFont("Times-Roman", 9)
        c.drawString(x + 0.5 * cm, base_y + 0.75 * cm, s.get("name", "") or "")
        # Role / designation
        c.setFont("Times-Roman", 8.5)
        c.drawString(x + 0.5 * cm, base_y + 0.35 * cm, s.get("role", "") or "")


class _IQACCanvas(rl_canvas.Canvas):
    """Canvas that defers final drawing so we can know total pages and
    paint the editable signature block on the LAST page only, pinned to bottom."""
    def __init__(self, *args, signatures=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_pages = []
        self._signatures = signatures or []

    def showPage(self):
        # Save the current page state so we can replay later
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_pages)
        for idx, state in enumerate(self._saved_pages):
            self.__dict__.update(state)
            if idx == total - 1:
                _draw_signature_block_at_bottom(self, self._signatures)
            super().showPage()
        super().save()


def _build_report_pdf(report: dict, dept_name: str = "", signatures=None) -> bytes:
    buf = io.BytesIO()
    sigs = signatures or DEFAULT_FOOTER_SIGNATURES
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=5.7 * cm,     # header (logo + institution + IQAC banner)
        bottomMargin=4.3 * cm,  # reserve room so content never overlaps the signature block
    )
    styles = getSampleStyleSheet()  # noqa: F841
    serif = "Times-Roman"
    serif_b = "Times-Bold"
    h_label = ParagraphStyle("h", fontName=serif_b, fontSize=10, leading=13)
    body = ParagraphStyle("b", fontName=serif, fontSize=10, leading=13)

    story = []

    # ----- Top tiny title (above table) -----
    story.append(Paragraph(
        "<para alignment='center'><b>Departmental Documentation — IQAC Sheet</b></para>",
        ParagraphStyle("dd", fontName=serif_b, fontSize=11, leading=14, spaceAfter=8)
    ))

    # ----- Main details table (label | value) -----
    def row(label, value):
        return [Paragraph(label, h_label), Paragraph(str(value or "&nbsp;"), body)]

    coord = f"{report.get('coordinator_name','')}"
    if report.get("coordinator_phone"):
        coord = f"{coord} &nbsp;·&nbsp; {report.get('coordinator_phone')}"

    details = [
        row("IQAC Cell Activity Number", report.get("activity_number")),
        row("Activity Number as per Association Schedule (Gyankhana 2025-26)",
            report.get("activity_schedule_number")),
        row("Type of Activity<br/><font size=8 color='#5C5F62'>(Curricular / Co-Curricular / Extra-Curricular / Extension / Society-based / Commemorative Days)</font>",
            report.get("activity_type")),
        row("Title of the Activity", report.get("title")),
        row("Date of Proposal", report.get("date_of_proposal")),
        row("Date of Activity", report.get("date_of_activity")),
        row("Time", report.get("time")),
        row("Faculty", report.get("faculty")),
        row("Department / Committee / Association", dept_name or report.get("committee", "")),
        row("Venue", report.get("venue")),
        row("No. of participants", report.get("no_of_participants")),
        row("Activity for class / group", report.get("activity_for")),
        row("Coordinator's Name &amp; Phone No.", coord),
        row("Members / Support", report.get("members")),
        row("Name of Invited Guest (Optional)", report.get("invited_guest")),
        row("Brief information about the Activity", (report.get("brief") or "").replace("\n", "<br/>")),
        row("Profile / Topic / Subject of the activity", (report.get("topic") or "").replace("\n", "<br/>")),
        row("Objectives for conducting the Activity", (report.get("objectives") or "").replace("\n", "<br/>")),
        row("Methodology<br/><font size=8 color='#5C5F62'>(Participative / Experiential / Problem Solving / Other)</font>",
            (report.get("methodology") or "").replace("\n", "<br/>")),
        row("Outcomes", (report.get("outcomes") or "").replace("\n", "<br/>")),
    ]
    t = Table(details, colWidths=[6.5 * cm, 11.5 * cm], repeatRows=0)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#7a6b5a")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f5efe4")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    # ----- Proofs Attached (with check marks, exactly like the form) -----
    story.append(Paragraph("<b>Proof Attached</b> &nbsp;<font size=8 color='#5C5F62'>(Put a tick ✓)</font>",
                 ParagraphStyle("p", fontName=serif_b, fontSize=10.5, leading=14, spaceAfter=4)))

    have = {p.get("category") for p in (report.get("proofs") or [])}
    proof_rows = []
    for idx, key in enumerate(PROOF_ORDER, start=1):
        tick = "☑" if key in have else "☐"
        proof_rows.append([
            Paragraph(f"{idx}.", body),
            Paragraph(PROOF_LABELS[key], body),
            Paragraph(f"<font size=13>{tick}</font>", body),
        ])
    pt = Table(proof_rows, colWidths=[0.8 * cm, 14.7 * cm, 2.5 * cm])
    pt.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#7a6b5a")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(pt)

    # Signature block is now rendered at the BOTTOM of the LAST page only
    # via the _IQACCanvas (see below) — not as an in-flow flowable.

    doc.build(
        story,
        onFirstPage=lambda c, d: _draw_header_footer(c, d, banner_text="Internal Quality Assurance Cell (IQAC)"),
        onLaterPages=lambda c, d: _draw_header_footer(c, d, banner_text="Internal Quality Assurance Cell (IQAC)"),
        canvasmaker=lambda *a, **k: _IQACCanvas(*a, signatures=sigs, **k),
    )
    return buf.getvalue()

@api.get("/reports/{rid}/pdf")
async def export_pdf(rid: str, user: dict = Depends(get_current_user)):
    doc = await db.reports.find_one({"_id": to_oid(rid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    if not _can_view_report(user, doc):
        raise HTTPException(status_code=403, detail="Forbidden")
    dept_name = ""
    if doc.get("department_id"):
        try:
            d = await db.departments.find_one({"_id": ObjectId(doc["department_id"])})
            if d:
                dept_name = d.get("name", "")
        except Exception:
            pass
    pdf_bytes = _build_report_pdf(doc, dept_name=dept_name, signatures=await get_footer_signatures())
    fname = f"IQAC_Sheet_{(doc.get('title') or 'report').replace(' ', '_')[:40]}.pdf"
    await audit(user, "report.pdf", target=rid)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ---- Notice & Timetable PDF builders ---------------------------------------
def _build_notice_pdf(notice: dict, signatures=None) -> bytes:
    buf = io.BytesIO()
    sigs = signatures or DEFAULT_FOOTER_SIGNATURES
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=5.7 * cm, bottomMargin=4.3 * cm,
    )
    serif = "Times-Roman"
    serif_b = "Times-Bold"
    body = ParagraphStyle("nb", fontName=serif, fontSize=11, leading=15, spaceAfter=6)
    body_bold = ParagraphStyle("nbb", fontName=serif_b, fontSize=11, leading=15)
    h_ctr = ParagraphStyle("nh", fontName=serif_b, fontSize=14, leading=18, alignment=1, spaceAfter=12)

    story = []
    dept = notice.get("department") or ""
    date_str = notice.get("date") or ""

    header_row = [
        [Paragraph(f"<b>Date:</b> {date_str or '&mdash;'}", body),
         Paragraph(dept or "", ParagraphStyle("nd", fontName=serif_b, fontSize=11, leading=13, alignment=2))]
    ]
    ht = Table(header_row, colWidths=[9 * cm, 9 * cm])
    ht.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0)]))
    story.append(ht)
    story.append(Spacer(1, 10))
    story.append(Paragraph("NOTICE", h_ctr))

    if notice.get("audience"):
        story.append(Paragraph(f"<b>To:</b> {notice['audience']}", body))
    story.append(Paragraph((notice.get("body") or "").replace("\n", "<br/>"), body))

    # Activity details table if present
    if any(notice.get(k) for k in ("activity_name", "activity_date", "activity_time", "venue")):
        story.append(Spacer(1, 8))
        rows = []
        for lbl, val in [
            ("Activity Name", notice.get("activity_name")),
            ("Date", notice.get("activity_date")),
            ("Time", notice.get("activity_time")),
            ("Venue", notice.get("venue")),
        ]:
            if val:
                rows.append([Paragraph(f"<b>{lbl}</b>", body), Paragraph(str(val), body)])
        if rows:
            at = Table(rows, colWidths=[5 * cm, 12.5 * cm])
            at.setStyle(TableStyle([
                ("BOX",(0,0),(-1,-1),0.5,colors.HexColor("#7a6b5a")),
                ("INNERGRID",(0,0),(-1,-1),0.3,colors.HexColor("#cdbfa8")),
                ("VALIGN",(0,0),(-1,-1),"TOP"),
                ("BACKGROUND",(0,0),(0,-1),colors.HexColor("#f5efe4")),
                ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
                ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
            ]))
            story.append(at)

    # Optional Proposal section
    if notice.get("proposal_body"):
        story.append(Spacer(1, 18))
        story.append(Paragraph("<b>To,</b><br/>I/c Principal,<br/>Ramsheth Thakur College of Commerce and Science,<br/>Kharghar, Navi Mumbai.", body))
        if notice.get("subject"):
            story.append(Paragraph(f"<b>Subject:</b> {notice['subject']}", body_bold))
        story.append(Paragraph(notice["proposal_body"].replace("\n", "<br/>"), body))
        if notice.get("budget"):
            story.append(Paragraph(f"<b>Budget:</b> Rs. {notice['budget']}", body))
        story.append(Paragraph("<br/>Kindly approve the above mentioned proposal for smooth conduction of course.", body))

    doc.build(story, onFirstPage=lambda c, d: _draw_header_footer(c, d, banner_text="Notice"),
              onLaterPages=lambda c, d: _draw_header_footer(c, d, banner_text="Notice"),
              canvasmaker=lambda *a, **k: _IQACCanvas(*a, signatures=sigs, **k))
    return buf.getvalue()


def _fmt_cell_entries(entries) -> str:
    """Render a list of DailyCellEntry dicts into display text, joined with '&' when combined."""
    if not entries:
        return ""
    blocks = []
    for e in entries:
        subj = (e.get("subject") or "").strip()
        batch = (e.get("batch") or "").strip()
        room = (e.get("room") or "").strip()
        fac = (e.get("faculty") or "").strip()
        line1 = subj
        if batch:
            line1 = f"{line1} ({batch})" if line1 else f"({batch})"
        if room:
            line1 = f"{line1} {room}".strip()
        block = line1
        if fac:
            block = f"{block}<br/>{fac}" if block else fac
        if block:
            blocks.append(block)
    return "<br/>&amp;<br/>".join(blocks)


def _build_daily_timetable_story(tt: dict, body, body_b, h_ctr):
    """Build the flowable story for a Daily Time Table (grid: time-slot rows x Mon-Sat columns)."""
    story = []
    story.append(Paragraph(f"Department of {tt.get('department') or ''}".strip(), 
                 ParagraphStyle("dep", fontName="Times-Bold", fontSize=12, leading=15, alignment=1, spaceAfter=2)))
    story.append(Paragraph(tt.get("title") or "Daily Time Table", h_ctr))
    meta_bits = []
    if tt.get("semester"):
        meta_bits.append(tt["semester"])
    if tt.get("academic_year"):
        meta_bits.append(f"AY {tt['academic_year']}")
    if meta_bits:
        story.append(Paragraph(" &nbsp;·&nbsp; ".join(meta_bits),
                     ParagraphStyle("meta", fontName="Times-Bold", fontSize=10.5, leading=13, alignment=1, spaceAfter=10)))
    story.append(Spacer(1, 4))

    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    day_labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    header = [Paragraph("<b>Time</b>", body)] + [Paragraph(f"<b>{d}</b>", body) for d in day_labels]
    rows = [header]
    for r in (tt.get("daily_rows") or []):
        cells = [Paragraph(str(r.get("time_slot") or ""), body_b)]
        for d in days:
            cells.append(Paragraph(_fmt_cell_entries(r.get(d) or []) or "&nbsp;", body))
        rows.append(cells)
    col_w = [2.6 * cm] + [2.68 * cm] * 6
    tbl = Table(rows, colWidths=col_w, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#7a6b5a")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f5efe4")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)
    return story


def _build_timetable_pdf(tt: dict, signatures=None) -> bytes:
    buf = io.BytesIO()
    sigs = signatures or DEFAULT_FOOTER_SIGNATURES
    is_daily = tt.get("type") == "daily"
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=5.7 * cm, bottomMargin=4.3 * cm,
    )
    serif = "Times-Roman"
    serif_b = "Times-Bold"
    body = ParagraphStyle("tb", fontName=serif, fontSize=9, leading=11.5)
    body_b = ParagraphStyle("tbb", fontName=serif_b, fontSize=9, leading=11.5)
    h_ctr = ParagraphStyle("th", fontName=serif_b, fontSize=13, leading=16, alignment=1, spaceAfter=4)

    story = []
    banner = "Daily Time Table" if is_daily else "Exam Time Table"

    if is_daily:
        story.extend(_build_daily_timetable_story(tt, body, body_b, h_ctr))
    else:
        story.append(Paragraph(tt.get("title") or "Examination Timetable", h_ctr))
        meta = [
            [Paragraph(f"<b>Committee:</b> {tt.get('committee') or 'Examination Committee'}", body),
             Paragraph(f"<b>Date:</b> {tt.get('date_issued') or ''}", body)],
            [Paragraph(f"<b>Class:</b> {tt.get('class_name') or ''}", body),
             Paragraph(f"<b>Semester:</b> {tt.get('semester') or ''}", body)],
        ]
        mt = Table(meta, colWidths=[9 * cm, 9 * cm])
        mt.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                                ("BOTTOMPADDING",(0,0),(-1,-1),4)]))
        story.append(mt)
        story.append(Spacer(1, 8))

        # Entries table
        rows = [[Paragraph("<b>Day / Date</b>", body),
                 Paragraph("<b>Time</b>", body),
                 Paragraph("<b>Subject</b>", body)]]
        for e in (tt.get("entries") or []):
            rows.append([
                Paragraph(str(e.get("day_date") or ""), body),
                Paragraph(str(e.get("time") or ""), body),
                Paragraph(str(e.get("subject") or ""), body),
            ])
        tbl = Table(rows, colWidths=[5 * cm, 4.5 * cm, 8 * cm], repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BOX",(0,0),(-1,-1),0.6,colors.black),
            ("INNERGRID",(0,0),(-1,-1),0.3,colors.HexColor("#7a6b5a")),
            ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#f5efe4")),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
            ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
        ]))
        story.append(tbl)

    doc.build(story, onFirstPage=lambda c, d: _draw_header_footer(c, d, banner_text=banner),
              onLaterPages=lambda c, d: _draw_header_footer(c, d, banner_text=banner),
              canvasmaker=lambda *a, **k: _IQACCanvas(*a, signatures=sigs, **k))
    return buf.getvalue()


# =============================================================================
# SETTINGS — PDF footer signatures (editable)
# =============================================================================
@api.get("/settings/pdf-footer")
async def get_pdf_footer(user: dict = Depends(get_current_user)):
    sigs = await get_footer_signatures()
    return {"signatures": sigs}

@api.put("/settings/pdf-footer")
async def update_pdf_footer(payload: FooterSettings, user: dict = Depends(get_current_user)):
    if len(payload.signatures) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 signature blocks are required")
    sigs = [s.model_dump() for s in payload.signatures]
    await db.settings.update_one(
        {"_id": "pdf_footer"},
        {"$set": {"signatures": sigs, "updated_at": _now().isoformat(),
                  "updated_by": user.get("email")}},
        upsert=True,
    )
    await audit(user, "settings.pdf_footer.update")
    return {"signatures": sigs}


# =============================================================================
# ANNOUNCEMENTS
# =============================================================================
@api.get("/announcements")
async def list_announcements(user: dict = Depends(get_current_user)):
    docs = await db.announcements.find({}).sort("created_at", -1).to_list(500)
    return [serialize(d) for d in docs]

@api.post("/announcements")
async def create_announcement(
    payload: AnnouncementCreate,
    user: dict = Depends(get_current_user),
):
    doc = payload.model_dump()
    doc.update({
        "created_by": str(user["_id"]),
        "created_by_name": user.get("name"),
        "created_by_role": user.get("role"),
        "created_at": _now().isoformat(),
    })
    res = await db.announcements.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "announcement.create", target=str(res.inserted_id), details=payload.title)
    return serialize(doc)

@api.delete("/announcements/{aid}")
async def delete_announcement(aid: str, user: dict = Depends(require_roles("admin", "coordinator"))):
    await db.announcements.delete_one({"_id": to_oid(aid)})
    await audit(user, "announcement.delete", target=aid)
    return {"ok": True}


# =============================================================================
# NOTICES — anyone creates/updates; author or admin/coordinator can delete
# =============================================================================
def _can_manage_own(user, doc, privileged=("admin",)):
    return user["role"] in privileged or doc.get("created_by") == str(user["_id"])

@api.get("/notices")
async def list_notices(user: dict = Depends(get_current_user)):
    docs = await db.notices.find({}).sort("created_at", -1).to_list(500)
    return [serialize(d) for d in docs]

@api.get("/notices/{nid}")
async def get_notice(nid: str, user: dict = Depends(get_current_user)):
    doc = await db.notices.find_one({"_id": to_oid(nid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Notice not found")
    return serialize(doc)

@api.post("/notices")
async def create_notice(payload: NoticeCreate, user: dict = Depends(get_current_user)):
    doc = payload.model_dump()
    doc.update({
        "created_by": str(user["_id"]),
        "created_by_name": user.get("name"),
        "created_by_role": user.get("role"),
        "created_at": _now().isoformat(),
        "updated_at": _now().isoformat(),
    })
    res = await db.notices.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "notice.create", target=str(res.inserted_id), details=payload.title)
    return serialize(doc)

@api.put("/notices/{nid}")
async def update_notice(nid: str, payload: NoticeUpdate, user: dict = Depends(get_current_user)):
    doc = await db.notices.find_one({"_id": to_oid(nid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Notice not found")
    if not _can_manage_own(user, doc):
        raise HTTPException(status_code=403, detail="You can only edit your own notices")
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = _now().isoformat()
    await db.notices.update_one({"_id": to_oid(nid)}, {"$set": upd})
    new_doc = await db.notices.find_one({"_id": to_oid(nid)})
    await audit(user, "notice.update", target=nid)
    return serialize(new_doc)

@api.delete("/notices/{nid}")
async def delete_notice(nid: str, user: dict = Depends(get_current_user)):
    doc = await db.notices.find_one({"_id": to_oid(nid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Notice not found")
    if not _can_manage_own(user, doc):
        raise HTTPException(status_code=403, detail="You can only delete your own notices")
    await db.notices.delete_one({"_id": to_oid(nid)})
    await audit(user, "notice.delete", target=nid)
    return {"ok": True}

@api.get("/notices/{nid}/pdf")
async def notice_pdf(nid: str, user: dict = Depends(get_current_user)):
    doc = await db.notices.find_one({"_id": to_oid(nid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Notice not found")
    pdf_bytes = _build_notice_pdf(doc, await get_footer_signatures())
    fname = f"Notice_{(doc.get('title') or 'notice').replace(' ', '_')[:40]}.pdf"
    await audit(user, "notice.pdf", target=nid)
    return StreamingResponse(iter([pdf_bytes]), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# =============================================================================
# TIMETABLES — Exam Time Table has strict RBAC (Exam dept + Admin + Coordinator);
# Daily Time Table keeps the normal owner-or-admin rule.
# =============================================================================
async def _is_exam_committee_member(user: dict) -> bool:
    """True if the user is a member of the (active) 'Exam' committee."""
    committee = await db.committees.find_one({"code": "EXAM"})
    if not committee or not committee.get("active", True):
        return False
    return str(user["_id"]) in (committee.get("members") or [])

async def _can_manage_exam_timetable(user: dict) -> bool:
    """Only Admin (Principal), IQAC Coordinator, or members of the Exam
    Committee may create/edit/delete Exam Time Tables. HODs / Faculty / Staff
    outside the Exam Committee cannot — even if they authored it previously."""
    if user["role"] in ("admin", "coordinator"):
        return True
    return await _is_exam_committee_member(user)

async def _can_manage_timetable(user: dict, doc: dict) -> bool:
    """Dispatch permission check based on the timetable's type."""
    tt_type = doc.get("type") or "exam"
    if tt_type == "exam":
        return await _can_manage_exam_timetable(user)
    return _can_manage_own(user, doc)


@api.get("/timetables")
async def list_timetables(type: Optional[str] = None, user: dict = Depends(get_current_user)):
    query: dict = {}
    if type == "exam":
        # legacy records created before the type field existed default to "exam"
        query["$or"] = [{"type": "exam"}, {"type": {"$exists": False}}]
    elif type:
        query["type"] = type
    docs = await db.timetables.find(query).sort("created_at", -1).to_list(500)
    return [serialize(d) for d in docs]

@api.get("/timetables/{tid}")
async def get_timetable(tid: str, user: dict = Depends(get_current_user)):
    doc = await db.timetables.find_one({"_id": to_oid(tid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Timetable not found")
    return serialize(doc)

@api.post("/timetables")
async def create_timetable(payload: TimetableCreate, user: dict = Depends(get_current_user)):
    if payload.type == "exam" and not await _can_manage_exam_timetable(user):
        raise HTTPException(
            status_code=403,
            detail="Only Admin, IQAC Coordinator, or members of the Exam Committee may create Exam Time Tables",
        )
    doc = payload.model_dump()
    doc.update({
        "created_by": str(user["_id"]),
        "created_by_name": user.get("name"),
        "created_by_role": user.get("role"),
        "created_at": _now().isoformat(),
        "updated_at": _now().isoformat(),
    })
    res = await db.timetables.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "timetable.create", target=str(res.inserted_id), details=payload.title)
    return serialize(doc)

@api.put("/timetables/{tid}")
async def update_timetable(tid: str, payload: TimetableUpdate, user: dict = Depends(get_current_user)):
    doc = await db.timetables.find_one({"_id": to_oid(tid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Timetable not found")
    if not await _can_manage_timetable(user, doc):
        raise HTTPException(status_code=403, detail="You do not have permission to edit this timetable")
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = _now().isoformat()
    await db.timetables.update_one({"_id": to_oid(tid)}, {"$set": upd})
    new_doc = await db.timetables.find_one({"_id": to_oid(tid)})
    await audit(user, "timetable.update", target=tid)
    return serialize(new_doc)

@api.delete("/timetables/{tid}")
async def delete_timetable(tid: str, user: dict = Depends(get_current_user)):
    doc = await db.timetables.find_one({"_id": to_oid(tid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Timetable not found")
    if not await _can_manage_timetable(user, doc):
        raise HTTPException(status_code=403, detail="You do not have permission to delete this timetable")
    await db.timetables.delete_one({"_id": to_oid(tid)})
    await audit(user, "timetable.delete", target=tid)
    return {"ok": True}

@api.get("/timetables/{tid}/pdf")
async def timetable_pdf(tid: str, user: dict = Depends(get_current_user)):
    doc = await db.timetables.find_one({"_id": to_oid(tid)})
    if not doc:
        raise HTTPException(status_code=404, detail="Timetable not found")
    pdf_bytes = _build_timetable_pdf(doc, await get_footer_signatures())
    fname = f"Timetable_{(doc.get('title') or 'timetable').replace(' ', '_')[:40]}.pdf"
    await audit(user, "timetable.pdf", target=tid)
    return StreamingResponse(iter([pdf_bytes]), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# =============================================================================
# AUDIT LOGS
# =============================================================================
@api.get("/audit-logs")
async def list_audit_logs(user: dict = Depends(require_roles("admin", "coordinator"))):
    docs = await db.audit_logs.find({}).sort("created_at", -1).limit(500).to_list(500)
    return [serialize(d) for d in docs]


# =============================================================================
# STATS — Dashboard analytics
# =============================================================================
@api.get("/stats/overview")
async def stats_overview(user: dict = Depends(get_current_user)):
    base: dict = {}
    if user["role"] == "hod":
        base["department_id"] = user.get("department_id")
    elif user["role"] == "staff":
        base["created_by"] = str(user["_id"])

    total = await db.reports.count_documents(base)
    by_status = {}
    for s in STATUSES:
        by_status[s] = await db.reports.count_documents({**base, "status": s})

    by_type = {}
    for t in ACTIVITY_TYPES:
        by_type[t] = await db.reports.count_documents({**base, "activity_type": t})

    # Monthly trend over last 6 months
    now = datetime.now(timezone.utc)
    trend = []
    for i in range(5, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)
        cnt = await db.reports.count_documents({
            **base,
            "created_at": {
                "$gte": month_start.isoformat(),
                "$lt": next_month.isoformat(),
            },
        })
        trend.append({"month": month_start.strftime("%b %Y"), "count": cnt})

    # Department-wise (admin/coordinator)
    by_department = []
    if user["role"] in ("admin", "coordinator"):
        depts = await db.departments.find({}).to_list(200)
        for d in depts:
            cnt = await db.reports.count_documents({"department_id": str(d["_id"])})
            approved = await db.reports.count_documents({"department_id": str(d["_id"]), "status": "approved"})
            by_department.append({
                "department": d.get("name"),
                "total": cnt,
                "approved": approved,
            })

    pending = await db.reports.count_documents({
        **base, "status": {"$in": ["submitted", "under_review", "revision_requested"]},
    })

    return {
        "total": total,
        "pending": pending,
        "approved": by_status["approved"],
        "rejected": by_status["rejected"],
        "by_status": by_status,
        "by_type": by_type,
        "trend": trend,
        "by_department": by_department,
        "users": await db.users.count_documents({}) if user["role"] == "admin" else None,
        "departments": await db.departments.count_documents({}) if user["role"] == "admin" else None,
    }


# =============================================================================
# Mount router
# =============================================================================
@api.get("/health")
async def health():
    return {"ok": True, "service": "iqac-portal"}

app.include_router(api)

# =============================================================================
# Personal AI Agent — mounted at /api/ai
# =============================================================================
from ai.routes import build_router as _build_ai_router  # noqa: E402

app.include_router(_build_ai_router(db=db, get_current_user=get_current_user))
