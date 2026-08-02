import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Download, Edit3, Trash2 } from "lucide-react";

export default function NoticeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [n, setN] = useState(null);

  useEffect(() => { api.get(`/notices/${id}`).then((r) => setN(r.data)).catch((e) => toast.error(formatApiError(e))); }, [id]);
  if (!n) return <div className="text-muted-foreground italic">Loading notice…</div>;

  const canManage = user.role === "admin" || n.created_by === user.id;

  const downloadPdf = async () => {
    const res = await api.get(`/notices/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `Notice_${(n.title || "notice").replace(/\s+/g, "_")}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const del = async () => {
    if (!window.confirm("Delete this notice permanently?")) return;
    try { await api.delete(`/notices/${id}`); toast.success("Deleted."); nav("/notices"); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="overline">{n.department || "Notice"} · {n.date || "—"}</div>
          <h1 className="font-serif text-4xl">{n.title}</h1>
          <div className="overline mt-1 text-[10px]">by {n.created_by_name}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button data-testid="notice-pdf-btn" onClick={downloadPdf} className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2"><Download size={15}/> Export PDF</button>
          {canManage && (
            <>
              <Link to={`/notices/${id}/edit`} data-testid="notice-edit-btn" className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2"><Edit3 size={15}/> Edit</Link>
              <button onClick={del} data-testid="notice-del-btn" className="px-3 py-2 border border-destructive/40 text-destructive rounded-sm hover:bg-destructive/5 text-sm inline-flex items-center gap-2"><Trash2 size={15}/> Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="paper p-6 max-w-3xl">
        {n.audience && <div className="mb-3"><span className="font-semibold">To:</span> {n.audience}</div>}
        <div className="text-center font-serif text-2xl mb-4 tracking-wider">NOTICE</div>
        <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>

        {(n.activity_name || n.activity_date || n.venue) && (
          <div className="mt-6 border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Activity Name", n.activity_name],
                  ["Date", n.activity_date],
                  ["Time", n.activity_time],
                  ["Venue", n.venue],
                ].filter(([, v]) => v).map(([l, v]) => (
                  <tr key={l} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 bg-ivory-alt font-medium w-56">{l}</td>
                    <td className="px-4 py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {n.proposal_body && (
          <div className="mt-8 border-t border-border pt-6">
            <div className="mb-3">
              <div>To,</div>
              <div>I/c Principal,</div>
              <div>Ramsheth Thakur College of Commerce and Science,</div>
              <div>Kharghar, Navi Mumbai.</div>
            </div>
            {n.subject && <div className="mb-3"><span className="font-semibold">Subject: </span>{n.subject}</div>}
            <p className="whitespace-pre-wrap leading-relaxed">{n.proposal_body}</p>
            {n.budget && <div className="mt-3"><span className="font-semibold">Budget: </span>Rs. {n.budget}</div>}
            <p className="mt-4 italic text-muted-foreground">Kindly approve the above mentioned proposal for smooth conduction of course.</p>
          </div>
        )}
      </div>
    </div>
  );
}
