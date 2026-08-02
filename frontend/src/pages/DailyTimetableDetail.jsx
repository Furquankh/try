import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, DAYS, DAY_LABELS } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Download, Edit3, Trash2 } from "lucide-react";

function cellText(entries) {
  if (!entries || entries.length === 0) return null;
  return entries.map((e, i) => (
    <div key={i} className={i > 0 ? "mt-1.5 pt-1.5 border-t border-dashed border-border" : ""}>
      <div className="font-medium text-foreground">
        {e.subject}{e.batch ? ` (${e.batch})` : ""} {e.room || ""}
      </div>
      {e.faculty && <div className="text-muted-foreground">{e.faculty}</div>}
    </div>
  ));
}

export default function DailyTimetableDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [t, setT] = useState(null);

  useEffect(() => { api.get(`/timetables/${id}`).then((r) => setT(r.data)).catch((e) => toast.error(formatApiError(e))); }, [id]);
  if (!t) return <div className="text-muted-foreground italic">Loading daily time table…</div>;

  const canManage = user.role === "admin" || t.created_by === user.id;

  const downloadPdf = async () => {
    const res = await api.get(`/timetables/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `DailyTimetable_${(t.title || "timetable").replace(/\s+/g, "_")}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const del = async () => {
    if (!window.confirm("Delete this daily time table permanently?")) return;
    try { await api.delete(`/timetables/${id}`); toast.success("Deleted."); nav("/daily-timetables"); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="overline">Daily Time Table · {t.date_issued || "—"}</div>
          <h1 className="font-serif text-4xl">{t.title}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            {t.department && <>Dept: <span className="font-medium text-foreground">{t.department}</span> · </>}
            Class: <span className="font-medium text-foreground">{t.class_name}</span> · Semester: <span className="font-medium text-foreground">{t.semester || "—"}</span>
            {t.academic_year && <> · AY: <span className="font-medium text-foreground">{t.academic_year}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button data-testid="dtt-pdf-btn" onClick={downloadPdf} className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2"><Download size={15}/> Export PDF</button>
          {canManage && (
            <>
              <Link to={`/daily-timetables/${id}/edit`} data-testid="dtt-edit-btn" className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2"><Edit3 size={15}/> Edit</Link>
              <button onClick={del} data-testid="dtt-del-btn" className="px-3 py-2 border border-destructive/40 text-destructive rounded-sm hover:bg-destructive/5 text-sm inline-flex items-center gap-2"><Trash2 size={15}/> Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="paper overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-ivory-alt border-b border-border">
            <tr className="text-left">
              <th className="px-3 py-3 overline text-[10px]">Time</th>
              {DAYS.map((d) => <th key={d} className="px-3 py-3 overline text-[10px]">{DAY_LABELS[d]}</th>)}
            </tr>
          </thead>
          <tbody>
            {(t.daily_rows || []).map((r, i) => (
              <tr key={i} className="border-b border-border last:border-0 align-top">
                <td className="px-3 py-3 font-medium whitespace-nowrap">{r.time_slot}</td>
                {DAYS.map((d) => (
                  <td key={d} className="px-3 py-3">{cellText(r[d]) || <span className="text-muted-foreground">—</span>}</td>
                ))}
              </tr>
            ))}
            {(!t.daily_rows || t.daily_rows.length === 0) && (
              <tr><td colSpan={7} className="text-center p-8 text-muted-foreground italic">No entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
