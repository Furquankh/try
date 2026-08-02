import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Download, CalendarClock } from "lucide-react";

export default function DailyTimetables() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const load = async () => setItems((await api.get("/timetables", { params: { type: "daily" } })).data);
  useEffect(() => { load(); }, []);

  const canManage = (t) => user.role === "admin" || t.created_by === user.id;

  const del = async (t) => {
    if (!window.confirm(`Delete daily timetable "${t.title}"?`)) return;
    try { await api.delete(`/timetables/${t.id}`); toast.success("Deleted."); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const downloadPdf = async (t) => {
    const res = await api.get(`/timetables/${t.id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `DailyTimetable_${(t.title || "timetable").replace(/\s+/g, "_")}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Academic Calendar</div>
          <h1 className="font-serif text-4xl">Daily Time Table</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Weekly class schedules — period-wise grid with subject, batch, room and faculty for Monday–Saturday.
          </p>
        </div>
        <Link to="/daily-timetables/new" data-testid="dtt-new-button" className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm hover:bg-burgundy-dark text-sm inline-flex items-center gap-2">
          <Plus size={15} /> New Daily Time Table
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="paper p-12 text-center">
          <CalendarClock size={28} className="mx-auto mb-3 text-muted-foreground" strokeWidth={1.4} />
          <p className="text-sm text-muted-foreground italic">No daily time tables yet.</p>
        </div>
      ) : (
        <div className="paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ivory-alt border-b border-border">
              <tr className="text-left">
                <th className="px-4 py-3 overline text-[10px]">Title</th>
                <th className="px-4 py-3 overline text-[10px]">Department</th>
                <th className="px-4 py-3 overline text-[10px]">Class</th>
                <th className="px-4 py-3 overline text-[10px]">Semester</th>
                <th className="px-4 py-3 overline text-[10px]">Author</th>
                <th className="px-4 py-3 overline text-[10px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40" data-testid={`dtt-row-${t.id}`}>
                  <td className="px-4 py-3">
                    <Link to={`/daily-timetables/${t.id}`} className="font-medium hover:text-burgundy">{t.title}</Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.department || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.class_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.semester || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.created_by_name}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => downloadPdf(t)} data-testid={`dtt-pdf-${t.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Download size={12}/> PDF</button>
                    {canManage(t) && (
                      <>
                        <Link to={`/daily-timetables/${t.id}/edit`} data-testid={`dtt-edit-${t.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Edit3 size={12}/> Edit</Link>
                        <button onClick={() => del(t)} data-testid={`dtt-del-${t.id}`} className="text-destructive hover:underline inline-flex items-center gap-1 text-xs"><Trash2 size={12}/> Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
