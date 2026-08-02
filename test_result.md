#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "Replace legacy Exam-department-based RBAC with a proper Committee Management module. Every staff member belongs to one Department and can optionally belong to one or more Committees. Committee membership must never change the staff's Department. Seed default committees (Exam, IQAC, NSS, Cultural, Sports, Placement). Only Exam-Committee members, Admin (Principal) and IQAC Coordinator may create/edit/delete/manage the Exam Timetable — no other role/module is affected. Admin can create/edit/delete/activate/deactivate committees and assign members. Admin can add brand-new committees (Anti-Ragging, Research, Admission, Discipline, etc.) with no code changes. Also verify the earlier bug fix that the PDF Settings page and Announcements creation are accessible to staff users."

backend:
  - task: "Committee CRUD endpoints (admin-only)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Added GET/POST/PUT/PATCH/DELETE /api/committees and PUT /api/committees/{id}/members. Only admin may mutate; all authenticated users may list/get. Codes stored uppercase, unique index. Toggle-active endpoint flips 'active' bool. Delete purges committee_id from every user."

  - task: "Default committees seeded at startup"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Startup seeds Exam, IQAC, NSS, Cultural, Sports, Placement (idempotent — only inserts missing ones). Manual smoke test confirmed all 6 present with active=True and members=[]."

  - task: "User create/update with committee_ids sync"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "UserCreate/UserUpdate now accept optional committee_ids: List[str]. Both endpoints bidirectionally sync committees.members. Also allowed 'coordinator' to create/update users (delete still admin-only). User delete purges the uid from every committee.members list."

  - task: "PUT /api/committees/{cid}/members bidirectional sync"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Replaces the members list, computes added/removed diff, and updates users.committee_ids on all affected users. Membership never touches users.department_id."

  - task: "Exam Timetable RBAC via Exam Committee membership"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Replaced _is_exam_dept_member with _is_exam_committee_member (looks up committees.code='EXAM', requires active=True, checks user id in members[]). _can_manage_exam_timetable still permits admin + coordinator regardless. Manual smoke: (a) staff NOT in Exam committee → POST exam timetable = 403, (b) admin adds staff to Exam committee → same request = 200, (c) admin removes → 403 again, (d) staff can still POST daily timetable = 200 (RBAC scoped to exam only)."

  - task: "PUT /api/settings/pdf-footer open to all authenticated users"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Changed dependency from require_roles('admin') to get_current_user. Manual curl test confirmed staff can PUT."

  - task: "POST /api/announcements open to all authenticated users"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Changed dependency from require_roles('admin','coordinator','hod') to get_current_user. Manual curl test confirmed staff can POST."

frontend:
  - task: "Committees page — CRUD + toggle active + assign members (admin-only)"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Committees.jsx, frontend/src/App.js, frontend/src/components/Layout.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "New /committees route (admin-only), sidebar entry with ShieldCheck icon (nav-committees). Table lists name/code/description/member-count/status with Deactivate/Edit/Delete actions. New-Committee modal (name, code, description, active). Members modal opens on member-count click — searchable user list with checkbox rows and Save Members. Screenshot verified both views."

  - task: "User form includes multi-select committee memberships"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Users.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Users table now shows a Committees column with per-user tags. Create/Edit modal has a grid of committee checkboxes (inactive committees disabled). Explanatory copy states Department is independent of Committee memberships. Sends committee_ids on create and edit."

  - task: "PDF Settings page accessible to all authenticated users"
    implemented: true
    working: "NA"
    file: "frontend/src/App.js, frontend/src/components/Layout.jsx, frontend/src/pages/Settings.jsx"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
        -working: false
        -agent: "user"
        -comment: "Staff hit /settings and got redirected to dashboard."
        -working: "NA"
        -agent: "main"
        -comment: "Removed role gate from <Route path='settings'> in App.js and from sidebar nav entry. Settings.jsx has no role gates; backend endpoint already open."

  - task: "Announcements creation accessible to all authenticated users"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Announcements.jsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "canCreate hardcoded to true so 'New Announcement' button is visible for every role."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 2
  run_ui: true

test_plan:
  current_focus:
    - "Committee CRUD endpoints (admin-only)"
    - "Default committees seeded at startup"
    - "User create/update with committee_ids sync"
    - "PUT /api/committees/{cid}/members bidirectional sync"
    - "Exam Timetable RBAC via Exam Committee membership"
    - "PUT /api/settings/pdf-footer open to all authenticated users"
    - "POST /api/announcements open to all authenticated users"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Please test the backend thoroughly for the new Committee Management module and the earlier permission fixes. Priorities:\n1. GET/POST/PUT/PATCH/DELETE /api/committees + PUT /api/committees/{id}/members — admin can mutate, non-admin only reads. Verify code uniqueness enforcement, uppercase normalization, and cascade cleanup on delete.\n2. Seed check — GET /api/committees returns at least the 6 defaults (Exam, IQAC, NSS, Cultural, Sports, Placement).\n3. Committee-member bidirectional sync — assigning a user via PUT /committees/{id}/members updates users.committee_ids; likewise editing a user with committee_ids updates committees.members. Deleting a user or committee cleans up the other side. Assert users.department_id is NEVER changed by committee operations.\n4. Exam Timetable RBAC: (a) admin can POST exam timetable, (b) IQAC coordinator can POST exam timetable, (c) HOD/staff NOT in Exam committee cannot (403), (d) HOD/staff who ARE in Exam committee can (200), (e) removing them from committee removes the permission, (f) if the Exam committee is deactivated, membership no longer grants permission, (g) NONE of these restrictions apply to daily timetables, notices, or reports (regression).\n5. Also re-verify: staff can PUT /api/settings/pdf-footer, and staff can POST /api/announcements.\n\nCredentials: admin=admin@rtccs.edu/admin123. There is likely a staff user staff@rtccs.edu/staff123 already; if login fails, create one via POST /api/users as admin (role='staff').\n\nDo not test the frontend yet — I will ask the user for permission separately."