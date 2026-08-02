import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2, Megaphone } from "lucide-react";

const PRIORITIES = [
  { v: "normal", label: "Normal" },
  { v: "important", label: "Important" },
  { v: "emergency", label: "Emergency" },
];

export default function Announcements() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [depts, setDepts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", priority: "normal", department_id: "" });

  const load = async () => {
    const [a, d] = await Promise.all([api.get("/announcements"), api.get("/departments")]);
    setList(a.data); setDepts(d.data);
  };
  useEffect(() => { load(); }, []);

  const canCreate = true;
  const canDelete = ["admin", "coordinator"].includes(user.role);

  const save = async () => {
    try {
      await api.post("/announcements", { ...form, department_id: form.department_id || null });
      toast.success("Announcement posted.");
      setOpen(false); setForm({ title: "", body: "", priority: "normal", department_id: "" });
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (a) => {
    if (!window.confirm("Delete this announcement?")) return;
    await api.delete(`/announcements/${a.id}`); load();
  };

  const toneFor = (p) => p === "emergency" ? "border-l-destructive" : p === "important" ? "border-l-[#D97706]" : "border-l-burgundy";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Notice Board</div>
          <h1 className="font-serif text-4xl">Announcements</h1>
          <p className="text-sm text-muted-foreground mt-2">Department-wide notices, policy updates and priority alerts.</p>
        </div>
        {canCreate && (
          <button data-testid="announce-new" onClick={() => setOpen(true)} className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm text-sm hover:bg-burgundy-dark inline-flex items-center gap-2">
            <Plus size={15} /> New Announcement
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="paper p-12 text-center">
          <Megaphone size={28} className="mx-auto mb-3 text-muted-foreground" strokeWidth={1.4} />
          <p className="text-sm text-muted-foreground italic">No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((a) => (
            <article key={a.id} className={`paper p-5 border-l-4 ${toneFor(a.priority)}`} data-testid={`announce-${a.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="overline mb-1">{a.priority} · {a.created_by_name} · {new Date(a.created_at).toLocaleDateString()}</div>
                  <h3 className="font-serif text-2xl text-foreground leading-tight">{a.title}</h3>
                  <p className="text-sm text-foreground mt-3 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                </div>
                {canDelete && (
                  <button onClick={() => del(a)} data-testid={`announce-del-${a.id}`} className="text-destructive p-1 hover:bg-destructive/10 rounded-sm">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-ivory border border-border rounded-sm p-6 w-full max-w-lg my-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="overline mb-1">Notice</div>
            <h2 className="font-serif text-2xl mb-5">New Announcement</h2>
            <div className="space-y-3">
              <div><label className="overline block mb-1">Title</label><input data-testid="announce-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" /></div>
              <div><label className="overline block mb-1">Body</label><textarea data-testid="announce-body" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="overline block mb-1">Priority</label>
                  <select data-testid="announce-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm">
                    {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="overline block mb-1">Target Dept (optional)</label>
                  <select data-testid="announce-dept" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm">
                    <option value="">Institute-wide</option>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
              <button data-testid="announce-save" onClick={save} className="px-4 py-2 bg-burgundy text-ivory text-sm rounded-sm hover:bg-burgundy-dark">Post</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
