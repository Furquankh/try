"""Backend tests for Notices, Timetables, Ownership permission model, and existing IQAC flow.

Iteration 5 focus:
  - Notices CRUD + PDF export
  - Timetables CRUD + PDF export
  - Ownership rules via _can_manage_own (admin/coordinator OR owner)
  - Sanity: IQAC report create -> submit -> approve -> PDF export still works.
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to reading /app/frontend/.env
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")

ADMIN_EMAIL = "principal@rtcollege.edu.in"
ADMIN_PASS = "Principal@2026"


def _client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    return r


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin():
    s = _client()
    r = _login(s, ADMIN_EMAIL, ADMIN_PASS)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def staff(admin):
    # create a staff user
    email = f"TEST_staff_{uuid.uuid4().hex[:8]}@rtcollege.edu.in"
    password = "Staff@2026"
    payload = {"name": "TEST Staff User", "email": email, "password": password, "role": "staff"}
    r = admin.post(f"{BASE_URL}/api/users", json=payload)
    assert r.status_code in (200, 201), f"create staff failed: {r.status_code} {r.text}"
    s = _client()
    lr = _login(s, email, password)
    assert lr.status_code == 200, f"staff login failed: {lr.status_code} {lr.text}"
    s._user_email = email  # type: ignore
    s._user_id = r.json().get("id")  # type: ignore
    return s


@pytest.fixture(scope="module")
def staff2(admin):
    email = f"TEST_staff2_{uuid.uuid4().hex[:8]}@rtcollege.edu.in"
    password = "Staff@2026"
    payload = {"name": "TEST Staff Two", "email": email, "password": password, "role": "staff"}
    r = admin.post(f"{BASE_URL}/api/users", json=payload)
    assert r.status_code in (200, 201), f"create staff2 failed: {r.status_code} {r.text}"
    s = _client()
    lr = _login(s, email, password)
    assert lr.status_code == 200
    return s


# ---------------- Health & auth ----------------
def test_health():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True


def test_admin_login_sets_cookie(admin):
    # cookie should be present in session jar
    names = {c.name for c in admin.cookies}
    assert any("access" in n.lower() or "token" in n.lower() or n for n in names), f"cookies: {names}"
    r = admin.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    me = r.json()
    assert me.get("email") == ADMIN_EMAIL
    assert me.get("role") == "admin"


def test_bad_login():
    s = _client()
    r = _login(s, ADMIN_EMAIL, "wrongpass")
    assert r.status_code in (400, 401, 403)


# ---------------- Notices CRUD (admin) ----------------
class TestNoticesAdmin:
    nid = None

    def test_create(self, admin):
        payload = {
            "title": "TEST Notice - Semester Exam Schedule",
            "date": "2026-01-15",
            "department": "Department of Computer Science",
            "audience": "TYBSc CS",
            "body": "This is a test notice body.",
            "venue": "Main Hall",
        }
        r = admin.post(f"{BASE_URL}/api/notices", json=payload)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["title"] == payload["title"]
        assert "id" in data or "_id" in data
        TestNoticesAdmin.nid = data.get("id") or data.get("_id")

    def test_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/notices")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        assert any((n.get("id") or n.get("_id")) == TestNoticesAdmin.nid for n in arr)

    def test_get_one(self, admin):
        r = admin.get(f"{BASE_URL}/api/notices/{TestNoticesAdmin.nid}")
        assert r.status_code == 200
        assert r.json()["title"].startswith("TEST Notice")

    def test_update(self, admin):
        r = admin.put(f"{BASE_URL}/api/notices/{TestNoticesAdmin.nid}",
                      json={"title": "TEST Notice UPDATED", "body": "updated body"})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "TEST Notice UPDATED"
        # verify via GET
        g = admin.get(f"{BASE_URL}/api/notices/{TestNoticesAdmin.nid}")
        assert g.json()["body"] == "updated body"

    def test_pdf(self, admin):
        r = admin.get(f"{BASE_URL}/api/notices/{TestNoticesAdmin.nid}/pdf")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"

    def test_delete(self, admin):
        r = admin.delete(f"{BASE_URL}/api/notices/{TestNoticesAdmin.nid}")
        assert r.status_code in (200, 204)
        g = admin.get(f"{BASE_URL}/api/notices/{TestNoticesAdmin.nid}")
        assert g.status_code == 404


# ---------------- Timetables CRUD (admin) ----------------
class TestTimetablesAdmin:
    tid = None

    def test_create(self, admin):
        payload = {
            "title": "TEST External Regular Exam Timetable Mar 2026",
            "class_name": "FY BSc CS",
            "semester": "II",
            "entries": [
                {"day_date": "2026-03-10 (Tue)", "time": "10:00-13:00", "subject": "Mathematics"},
                {"day_date": "2026-03-12 (Thu)", "time": "10:00-13:00", "subject": "Programming in C"},
            ],
        }
        r = admin.post(f"{BASE_URL}/api/timetables", json=payload)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d["class_name"] == "FY BSc CS"
        assert len(d["entries"]) == 2
        TestTimetablesAdmin.tid = d.get("id") or d.get("_id")

    def test_list_and_get(self, admin):
        r = admin.get(f"{BASE_URL}/api/timetables")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        g = admin.get(f"{BASE_URL}/api/timetables/{TestTimetablesAdmin.tid}")
        assert g.status_code == 200
        assert g.json()["semester"] == "II"

    def test_update(self, admin):
        r = admin.put(f"{BASE_URL}/api/timetables/{TestTimetablesAdmin.tid}",
                      json={"semester": "III"})
        assert r.status_code == 200, r.text
        assert r.json()["semester"] == "III"

    def test_pdf(self, admin):
        r = admin.get(f"{BASE_URL}/api/timetables/{TestTimetablesAdmin.tid}/pdf")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"

    def test_delete(self, admin):
        r = admin.delete(f"{BASE_URL}/api/timetables/{TestTimetablesAdmin.tid}")
        assert r.status_code in (200, 204)
        g = admin.get(f"{BASE_URL}/api/timetables/{TestTimetablesAdmin.tid}")
        assert g.status_code == 404


# ---------------- Ownership permission matrix ----------------
class TestOwnership:
    notice_staff = None
    notice_staff2 = None
    tt_staff = None
    tt_staff2 = None

    def test_staff_creates_notice_and_timetable(self, staff):
        r = staff.post(f"{BASE_URL}/api/notices", json={
            "title": "TEST Staff Notice", "body": "staff body"
        })
        assert r.status_code in (200, 201), r.text
        TestOwnership.notice_staff = r.json().get("id") or r.json().get("_id")

        r2 = staff.post(f"{BASE_URL}/api/timetables", json={
            "title": "TEST Staff TT", "class_name": "SYBSc IT", "semester": "III",
            "entries": [{"day_date": "2026-04-01", "time": "9-11", "subject": "DS"}]
        })
        assert r2.status_code in (200, 201), r2.text
        TestOwnership.tt_staff = r2.json().get("id") or r2.json().get("_id")

    def test_staff2_creates_its_own(self, staff2):
        r = staff2.post(f"{BASE_URL}/api/notices", json={
            "title": "TEST Staff2 Notice", "body": "s2"
        })
        assert r.status_code in (200, 201)
        TestOwnership.notice_staff2 = r.json().get("id") or r.json().get("_id")
        r2 = staff2.post(f"{BASE_URL}/api/timetables", json={
            "title": "TEST Staff2 TT", "class_name": "TYBSc CS",
            "entries": [{"day_date": "2026-04-05", "time": "10-12", "subject": "AI"}]
        })
        assert r2.status_code in (200, 201)
        TestOwnership.tt_staff2 = r2.json().get("id") or r2.json().get("_id")

    def test_staff_cannot_update_others_notice(self, staff):
        r = staff.put(f"{BASE_URL}/api/notices/{TestOwnership.notice_staff2}",
                      json={"title": "hack"})
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_staff_cannot_delete_others_notice(self, staff):
        r = staff.delete(f"{BASE_URL}/api/notices/{TestOwnership.notice_staff2}")
        assert r.status_code == 403

    def test_staff_can_update_own_notice(self, staff):
        r = staff.put(f"{BASE_URL}/api/notices/{TestOwnership.notice_staff}",
                      json={"title": "TEST Staff Notice v2"})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "TEST Staff Notice v2"

    def test_staff_cannot_update_others_timetable(self, staff):
        r = staff.put(f"{BASE_URL}/api/timetables/{TestOwnership.tt_staff2}",
                      json={"semester": "hack"})
        assert r.status_code == 403

    def test_staff_cannot_delete_others_timetable(self, staff):
        r = staff.delete(f"{BASE_URL}/api/timetables/{TestOwnership.tt_staff2}")
        assert r.status_code == 403

    def test_staff_can_update_own_timetable(self, staff):
        r = staff.put(f"{BASE_URL}/api/timetables/{TestOwnership.tt_staff}",
                      json={"semester": "IV"})
        assert r.status_code == 200
        assert r.json()["semester"] == "IV"

    def test_staff_can_delete_own_notice(self, staff):
        r = staff.delete(f"{BASE_URL}/api/notices/{TestOwnership.notice_staff}")
        assert r.status_code in (200, 204)

    def test_staff_can_delete_own_timetable(self, staff):
        r = staff.delete(f"{BASE_URL}/api/timetables/{TestOwnership.tt_staff}")
        assert r.status_code in (200, 204)

    def test_admin_can_delete_any_notice(self, admin):
        # delete staff2's notice as admin
        r = admin.delete(f"{BASE_URL}/api/notices/{TestOwnership.notice_staff2}")
        assert r.status_code in (200, 204), r.text

    def test_admin_can_delete_any_timetable(self, admin):
        r = admin.delete(f"{BASE_URL}/api/timetables/{TestOwnership.tt_staff2}")
        assert r.status_code in (200, 204)


# ---------------- IQAC Report end-to-end ----------------
class TestIQACReport:
    rid = None

    def test_create(self, admin):
        payload = {
            "activity_type": "Workshop",
            "title": "TEST IQAC Workshop e2e",
            "date_of_activity": "2026-02-10",
            "venue": "Auditorium",
            "no_of_participants": 42,
            "brief": "brief",
            "objectives": "obj",
            "outcomes": "out",
        }
        r = admin.post(f"{BASE_URL}/api/reports", json=payload)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        TestIQACReport.rid = d.get("id") or d.get("_id")
        assert TestIQACReport.rid

    def test_submit_and_approve(self, admin):
        # workflow: submit
        r = admin.post(f"{BASE_URL}/api/reports/{TestIQACReport.rid}/workflow",
                       json={"action": "submit"})
        assert r.status_code in (200, 201, 204), f"submit: {r.status_code} {r.text}"
        # workflow: approve (submitted -> under_review as admin)
        a = admin.post(f"{BASE_URL}/api/reports/{TestIQACReport.rid}/workflow",
                       json={"action": "approve"})
        assert a.status_code in (200, 201, 204), f"approve1: {a.status_code} {a.text}"
        # workflow: approve again (under_review -> approved as admin)
        a2 = admin.post(f"{BASE_URL}/api/reports/{TestIQACReport.rid}/workflow",
                        json={"action": "approve"})
        assert a2.status_code in (200, 201, 204), f"approve2: {a2.status_code} {a2.text}"
        # verify status
        g = admin.get(f"{BASE_URL}/api/reports/{TestIQACReport.rid}")
        assert g.json().get("status") == "approved"

    def test_pdf(self, admin):
        r = admin.get(f"{BASE_URL}/api/reports/{TestIQACReport.rid}/pdf")
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"

    def test_cleanup(self, admin):
        admin.delete(f"{BASE_URL}/api/reports/{TestIQACReport.rid}")
