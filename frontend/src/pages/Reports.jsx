import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ACTIVITY_TYPES } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import { Search, Plus } from "lucide-react";

const STATUS_OPTIONS = [
  { v: "", label: "All Statuses" },
  { v: "draft", label: "Draft" },
  { v: "submitted", label: "Submitted" },
  { v: "under_review", label: "Under Review" },
  { v: "approved", label: "Approved" },
  { v: "rejected", label: "Rejected" },
  { v: "revision_requested", label: "Revision Requested" },
];

export default function Reports() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [activityType, setActivityType] = useState("");
  const [depts, setDepts] = useState([]);
  const [department, setDepartment] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      if (status) params.status = status;
      if (activityType) params.activity_type = activityType;
      if (department) params.department_id = department;
      const { data } = await api.get("/reports", { params });
      setReports(data);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    api.get("/departments").then((r) => setDepts(r.data)).catch(() => {});
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, activityType, department]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline mb-1">Departmental Documentation</div>
          <h1 className="font-serif text-4xl text-foreground">IQAC Sheets</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Browse, filter, and manage all IQAC sheets in the institute.
          </p>
        </div>
        <Link
          to="/reports/new"
          data-testid="reports-new-button"
          className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm hover:bg-burgundy-dark transition-colors text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus size={16} /> New IQAC Sheet
        </Link>
      </div>

      <div className="paper p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                data-testid="reports-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load()}
                placeholder="Search by title, venue, faculty, topic…"
                className="w-full pl-9 pr-3 py-2 border border-border rounded-sm bg-white focus:outline-none focus:border-burgundy"
              />
            </div>
          </div>
          <select data-testid="filter-status" className="md:col-span-2 px-3 py-2 border border-border rounded-sm bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select data-testid="filter-type" className="md:col-span-2 px-3 py-2 border border-border rounded-sm bg-white" value={activityType} onChange={(e) => setActivityType(e.target.value)}>
            <option value="">All Types</option>
            {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select data-testid="filter-department" className="md:col-span-2 px-3 py-2 border border-border rounded-sm bg-white" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All Depts</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button data-testid="filter-apply" onClick={load} className="md:col-span-1 px-3 py-2 border border-burgundy text-burgundy rounded-sm hover:bg-burgundy/5">
            Go
          </button>
        </div>
      </div>

      <div className="paper overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ivory-alt border-b border-border">
            <tr className="text-left">
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Date</Th>
              <Th>Author</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center p-10 text-muted-foreground italic">Loading…</td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={6} className="text-center p-10 text-muted-foreground italic">No reports found.</td></tr>
            ) : reports.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40 transition-colors" data-testid={`report-row-${r.id}`}>
                <td className="px-4 py-3 align-top">
                  <Link to={`/reports/${r.id}`} className="font-medium text-foreground hover:text-burgundy">
                    {r.title}
                  </Link>
                  {r.venue && <div className="overline text-[10px] mt-1">@ {r.venue}</div>}
                </td>
                <td className="px-4 py-3 align-top text-muted-foreground">{r.activity_type}</td>
                <td className="px-4 py-3 align-top text-muted-foreground">{r.date_of_activity || "—"}</td>
                <td className="px-4 py-3 align-top text-muted-foreground">{r.created_by_name || "—"}</td>
                <td className="px-4 py-3 align-top"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 align-top text-right">
                  <Link
                    to={`/reports/${r.id}`}
                    data-testid={`open-report-${r.id}`}
                    className="text-burgundy hover:underline"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`px-4 py-3 overline text-[10px] ${className}`}>{children}</th>;
}
