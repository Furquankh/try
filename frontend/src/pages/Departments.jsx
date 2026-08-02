import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Plus, Trash2, Edit3 } from "lucide-react";

export default function Departments() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", description: "" });

  const load = async () => setList((await api.get("/departments")).data);
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing) await api.put(`/departments/${editing.id}`, form);
      else await api.post("/departments", form);
      toast.success("Saved."); setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const del = async (d) => {
    if (!window.confirm(`Delete ${d.name}?`)) return;
    try { await api.delete(`/departments/${d.id}`); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Administration</div>
          <h1 className="font-serif text-4xl">Departments</h1>
          <p className="text-sm text-muted-foreground mt-2">Academic departments, committees and associations.</p>
        </div>
        <button data-testid="dept-new" onClick={() => { setEditing(null); setForm({ name: "", code: "", description: "" }); setOpen(true); }} className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm text-sm hover:bg-burgundy-dark inline-flex items-center gap-2">
          <Plus size={15} /> New Department
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((d) => (
          <div key={d.id} className="paper p-5" data-testid={`dept-card-${d.id}`}>
            <div className="overline">{d.code}</div>
            <h3 className="font-serif text-xl mt-1 mb-2">{d.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-3 min-h-[3rem]">{d.description || "—"}</p>
            <div className="mt-4 pt-3 border-t border-border flex gap-3">
              <button data-testid={`dept-edit-${d.id}`} onClick={() => { setEditing(d); setForm({ name: d.name, code: d.code, description: d.description || "" }); setOpen(true); }} className="text-xs text-burgundy inline-flex items-center gap-1 hover:underline"><Edit3 size={12}/> Edit</button>
              <button data-testid={`dept-del-${d.id}`} onClick={() => del(d)} className="text-xs text-destructive inline-flex items-center gap-1 hover:underline"><Trash2 size={12}/> Delete</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="col-span-full text-center text-sm text-muted-foreground italic py-10">No departments yet — add your first department.</div>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-ivory border border-border rounded-sm p-6 w-full max-w-md my-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="overline mb-1">Department</div>
            <h2 className="font-serif text-2xl mb-5">{editing ? "Edit Department" : "Create Department"}</h2>
            <div className="space-y-3">
              <div><label className="overline block mb-1">Name</label><input data-testid="dept-name" className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="overline block mb-1">Code</label><input data-testid="dept-code" className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BSC-IT" /></div>
              <div><label className="overline block mb-1">Description</label><textarea data-testid="dept-desc" rows={3} className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
              <button data-testid="dept-save" onClick={save} className="px-4 py-2 bg-burgundy text-ivory text-sm rounded-sm hover:bg-burgundy-dark">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
