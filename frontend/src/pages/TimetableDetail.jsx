import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, canManageExamTimetable } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Download, Edit3, Trash2 } from "lucide-react";

export default function TimetableDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [t, setT] = useState(null);
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    api.get(`/timetables/${id}`).then((r) => setT(r.data)).catch((e) => toast.error(formatApiError(e)));
    api.get("/departments").then((r) => setDepartments(r.data)).catch(() => {});
  }, [id]);
  if (!t) return <div className="text-muted-foreground italic">Loading timetable…</div>;

  const canManage = canManageExamTimetable(user, departments);

  const downloadPdf = async () => {
    const res = await api.get(`/timetables/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `Timetable_${(t.title || "timetable").replace(/\s+/g, "_")}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const del = async () => {
    if (!window.confirm("Delete this timetable permanently?")) return;
    try { await api.delete(`/timetables/${id}`); toast.success("Deleted."); nav("/timetables"); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="overline">{t.committee || "Examination Committee"} · {t.date_issued || "—"}</div>
          <h1 className="font-serif text-4xl">{t.title}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            Class: <span className="font-medium text-foreground">{t.class_name}</span> · Semester: <span className="font-medium text-foreground">{t.semester || "—"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button data-testid="tt-pdf-btn" onClick={downloadPdf} className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2"><Download size={15}/> Export PDF</button>
          {canManage && (
            <>
              <Link to={`/timetables/${id}/edit`} data-testid="tt-edit-btn" className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2"><Edit3 size={15}/> Edit</Link>
              <button onClick={del} data-testid="tt-del-btn" className="px-3 py-2 border border-destructive/40 text-destructive rounded-sm hover:bg-destructive/5 text-sm inline-flex items-center gap-2"><Trash2 size={15}/> Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="paper overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ivory-alt border-b border-border">
            <tr className="text-left">
              <th className="px-4 py-3 overline text-[10px]">Day / Date</th>
              <th className="px-4 py-3 overline text-[10px]">Time</th>
              <th className="px-4 py-3 overline text-[10px]">Subject</th>
            </tr>
          </thead>
          <tbody>
            {(t.entries || []).map((e, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{e.day_date}</td>
                <td className="px-4 py-3 text-muted-foreground">{e.time}</td>
                <td className="px-4 py-3">{e.subject}</td>
              </tr>
            ))}
            {(!t.entries || t.entries.length === 0) && (
              <tr><td colSpan={3} className="text-center p-8 text-muted-foreground italic">No entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
