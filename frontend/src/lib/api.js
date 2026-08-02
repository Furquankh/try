import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const FILE_BASE = BACKEND_URL;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err?.message || "Something went wrong.";
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (d && typeof d.msg === "string") return d.msg;
  return String(d);
}

export const STATUS_LABEL = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision Requested",
};

export const STATUS_COLOR = {
  draft: { bg: "#6B7280", fg: "#F9F8F6" },
  submitted: { bg: "#D97706", fg: "#F9F8F6" },
  under_review: { bg: "#2563EB", fg: "#F9F8F6" },
  approved: { bg: "#1F4A38", fg: "#F9F8F6" },
  rejected: { bg: "#DC2626", fg: "#F9F8F6" },
  revision_requested: { bg: "#9333EA", fg: "#F9F8F6" },
};

export const ACTIVITY_TYPES = [
  "Curricular",
  "Co-Curricular",
  "Extra-Curricular",
  "Extension",
  "Society-based",
  "Commemorative Days",
];

export const PROOF_CATEGORIES = [
  { key: "proposal", label: "Duly signed proposal" },
  { key: "notice", label: "Notice" },
  { key: "timetable", label: "Time Table / Programme" },
  { key: "invitation", label: "Letters of Invitation & Appreciation" },
  { key: "attendance", label: "Attendance List" },
  { key: "event_report", label: "Event Report with Geotagged Photos" },
  { key: "feedback", label: "Feedback & Feedback Analysis" },
  { key: "news", label: "News" },
  { key: "reels", label: "Publicity / Reels Link" },
  { key: "certificate", label: "Sample Certificate" },
  { key: "other", label: "Any Other" },
];

export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const DAY_LABELS = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday",
};

// Exam Time Table RBAC: only Admin, Coordinator, or members of the "Exam"
// department may create/edit/delete Exam Time Tables (mirrors backend rule).
export function canManageExamTimetable(user, departments) {
  if (!user) return false;
  if (["admin", "coordinator"].includes(user.role)) return true;
  const examDept = (departments || []).find((d) => d.name === "Exam");
  return !!examDept && user.department_id === examDept.id;
}
