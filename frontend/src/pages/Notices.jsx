import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Download, FileText } from "lucide-react";

export default function Notices() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const load = async () => setItems((await api.get("/notices")).data);
  useEffect(() => { load(); }, []);

  const canManage = (n) => user.role === "admin" || n.created_by === user.id;

  const del = async (n) => {
    if (!window.confirm(`Delete notice "${n.title}"?`)) return;
    try { await api.delete(`/notices/${n.id}`); toast.success("Deleted."); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const downloadPdf = async (n) => {
    const res = await api.get(`/notices/${n.id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `Notice_${(n.title || "notice").replace(/\s+/g, "_")}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Communications</div>
          <h1 className="font-serif text-4xl">Notices</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Departmental notices to students and staff — issue, edit, and export as PDF letterhead.
          </p>
        </div>
        <Link to="/notices/new" data-testid="notice-new-button" className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm hover:bg-burgundy-dark text-sm inline-flex items-center gap-2">
          <Plus size={15} /> New Notice
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="paper p-12 text-center">
          <FileText size={28} className="mx-auto mb-3 text-muted-foreground" strokeWidth={1.4} />
          <p className="text-sm text-muted-foreground italic">No notices yet.</p>
        </div>
      ) : (
        <div className="paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ivory-alt border-b border-border">
              <tr className="text-left">
                <th className="px-4 py-3 overline text-[10px]">Title</th>
                <th className="px-4 py-3 overline text-[10px]">Department</th>
                <th className="px-4 py-3 overline text-[10px]">Date</th>
                <th className="px-4 py-3 overline text-[10px]">Author</th>
                <th className="px-4 py-3 overline text-[10px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40" data-testid={`notice-row-${n.id}`}>
                  <td className="px-4 py-3">
                    <Link to={`/notices/${n.id}`} className="font-medium hover:text-burgundy">{n.title}</Link>
                    {n.audience && <div className="overline text-[10px] mt-0.5">To: {n.audience}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{n.department || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{n.date || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{n.created_by_name}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => downloadPdf(n)} data-testid={`notice-pdf-${n.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Download size={12}/> PDF</button>
                    {canManage(n) && (
                      <>
                        <Link to={`/notices/${n.id}/edit`} data-testid={`notice-edit-${n.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Edit3 size={12}/> Edit</Link>
                        <button onClick={() => del(n)} data-testid={`notice-del-${n.id}`} className="text-destructive hover:underline inline-flex items-center gap-1 text-xs"><Trash2 size={12}/> Delete</button>
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
