import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError, canManageExamTimetable } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Download, CalendarDays } from "lucide-react";

export default function Timetables() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const load = async () => setItems((await api.get("/timetables", { params: { type: "exam" } })).data);
  useEffect(() => {
    load();
    api.get("/departments").then((r) => setDepartments(r.data)).catch(() => {});
  }, []);

  const canManage = canManageExamTimetable(user, departments);

  const del = async (t) => {
    if (!window.confirm(`Delete timetable "${t.title}"?`)) return;
    try { await api.delete(`/timetables/${t.id}`); toast.success("Deleted."); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const downloadPdf = async (t) => {
    const res = await api.get(`/timetables/${t.id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `Timetable_${(t.title || "timetable").replace(/\s+/g, "_")}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Academic Calendar</div>
          <h1 className="font-serif text-4xl">Time Tables</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Examination and class timetables — day-wise schedule with class, semester and subjects.
          </p>
        </div>
        {canManage && (
          <Link to="/timetables/new" data-testid="tt-new-button" className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm hover:bg-burgundy-dark text-sm inline-flex items-center gap-2">
            <Plus size={15} /> New Timetable
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className="paper p-12 text-center">
          <CalendarDays size={28} className="mx-auto mb-3 text-muted-foreground" strokeWidth={1.4} />
          <p className="text-sm text-muted-foreground italic">No timetables yet.</p>
        </div>
      ) : (
        <div className="paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ivory-alt border-b border-border">
              <tr className="text-left">
                <th className="px-4 py-3 overline text-[10px]">Title</th>
                <th className="px-4 py-3 overline text-[10px]">Class</th>
                <th className="px-4 py-3 overline text-[10px]">Semester</th>
                <th className="px-4 py-3 overline text-[10px]">Entries</th>
                <th className="px-4 py-3 overline text-[10px]">Author</th>
                <th className="px-4 py-3 overline text-[10px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40" data-testid={`tt-row-${t.id}`}>
                  <td className="px-4 py-3">
                    <Link to={`/timetables/${t.id}`} className="font-medium hover:text-burgundy">{t.title}</Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.class_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.semester || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.entries?.length || 0}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.created_by_name}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => downloadPdf(t)} data-testid={`tt-pdf-${t.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Download size={12}/> PDF</button>
                    {canManage && (
                      <>
                        <Link to={`/timetables/${t.id}/edit`} data-testid={`tt-edit-${t.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Edit3 size={12}/> Edit</Link>
                        <button onClick={() => del(t)} data-testid={`tt-del-${t.id}`} className="text-destructive hover:underline inline-flex items-center gap-1 text-xs"><Trash2 size={12}/> Delete</button>
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
