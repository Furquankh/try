import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Plus, Trash2, Edit3 } from "lucide-react";

const ROLES = [
  { v: "admin", label: "Principal / Admin" },
  { v: "coordinator", label: "IQAC Coordinator" },
  { v: "hod", label: "Head of Department" },
  { v: "staff", label: "Faculty / Staff" },
];

const EMPTY_FORM = {
  name: "",
  email: "",
  password: "",
  role: "staff",
  department_id: "",
  phone: "",
  committee_ids: [],
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    const [u, d, c] = await Promise.all([
      api.get("/users"),
      api.get("/departments"),
      api.get("/committees").catch(() => ({ data: [] })),
    ]);
    setUsers(u.data);
    setDepts(d.data);
    setCommittees(c.data || []);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };
  const startEdit = (u) => {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
      department_id: u.department_id || "",
      phone: u.phone || "",
      committee_ids: u.committee_ids || [],
    });
    setOpen(true);
  };

  const toggleCommittee = (cid) => {
    setForm((f) => {
      const has = (f.committee_ids || []).includes(cid);
      return {
        ...f,
        committee_ids: has
          ? f.committee_ids.filter((x) => x !== cid)
          : [...(f.committee_ids || []), cid],
      };
    });
  };

  const save = async () => {
    try {
      if (editing) {
        const payload = {
          name: form.name,
          role: form.role,
          department_id: form.department_id || null,
          phone: form.phone,
          committee_ids: form.committee_ids || [],
        };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editing.id}`, payload);
        toast.success("User updated.");
      } else {
        await api.post("/users", {
          ...form,
          department_id: form.department_id || null,
          committee_ids: form.committee_ids || [],
        });
        toast.success("User created.");
      }
      setOpen(false);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (u) => {
    if (!window.confirm(`Delete ${u.email}?`)) return;
    try { await api.delete(`/users/${u.id}`); toast.success("Deleted."); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const deptName = (id) => depts.find((d) => d.id === id)?.name || "—";
  const committeeName = (id) => committees.find((c) => c.id === id)?.name;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Administration</div>
          <h1 className="font-serif text-4xl">Users &amp; Roles</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Manage faculty, HODs, coordinators and administrators. Assign committees
            during creation — committee membership is independent of Department.
          </p>
        </div>
        <button data-testid="users-new-button" onClick={startNew} className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm text-sm hover:bg-burgundy-dark inline-flex items-center gap-2">
          <Plus size={15} /> New User
        </button>
      </div>

      <div className="paper overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ivory-alt border-b border-border">
            <tr className="text-left">
              <th className="px-4 py-3 overline text-[10px]">Name</th>
              <th className="px-4 py-3 overline text-[10px]">Email</th>
              <th className="px-4 py-3 overline text-[10px]">Role</th>
              <th className="px-4 py-3 overline text-[10px]">Department</th>
              <th className="px-4 py-3 overline text-[10px]">Committees</th>
              <th className="px-4 py-3 overline text-[10px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40" data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.email}</td>
                <td className="px-4 py-3"><span className="overline text-[10px] px-2 py-0.5 bg-ivory-alt border border-border rounded-sm">{u.role}</span></td>
                <td className="px-4 py-3 text-muted-foreground">{deptName(u.department_id)}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {(u.committee_ids || []).length === 0 ? (
                    <span className="italic">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(u.committee_ids || []).map((cid) => {
                        const n = committeeName(cid);
                        return n ? (
                          <span key={cid} className="px-1.5 py-0.5 bg-ivory-alt border border-border rounded-sm">{n}</span>
                        ) : null;
                      })}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => startEdit(u)} data-testid={`user-edit-${u.id}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Edit3 size={12} /> Edit</button>
                  <button onClick={() => del(u)} data-testid={`user-delete-${u.id}`} className="text-destructive hover:underline inline-flex items-center gap-1 text-xs"><Trash2 size={12} /> Delete</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="text-center p-10 text-muted-foreground italic">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-ivory border border-border rounded-sm p-6 w-full max-w-lg my-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="overline mb-1">User Account</div>
            <h2 className="font-serif text-2xl mb-5">{editing ? "Edit User" : "Create User"}</h2>
            <div className="space-y-3">
              <Input label="Full Name" testid="user-name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Input label="Email" testid="user-email" value={form.email} disabled={!!editing} onChange={(v) => setForm({ ...form, email: v })} />
              <Input label={editing ? "New Password (leave blank to keep)" : "Password"} testid="user-password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
              <div>
                <label className="overline block mb-1">Role</label>
                <select data-testid="user-role" className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="overline block mb-1">Department</label>
                <select data-testid="user-dept" className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                  <option value="">— None —</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Department is separate from Committee memberships.</p>
              </div>
              <Input label="Phone" testid="user-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <div>
                <label className="overline block mb-1">Committee Memberships</label>
                {committees.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No committees available. Create some from the Committees page.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 border border-border rounded-sm p-3 bg-white">
                    {committees.map((c) => {
                      const checked = (form.committee_ids || []).includes(c.id);
                      return (
                        <label
                          key={c.id}
                          data-testid={`user-committee-${c.code}`}
                          className={`flex items-center gap-2 text-sm cursor-pointer px-2 py-1 rounded-sm hover:bg-ivory-alt ${!c.active ? "opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!c.active}
                            onChange={() => toggleCommittee(c.id)}
                            className="accent-burgundy"
                          />
                          <span>{c.name}</span>
                          {!c.active && <span className="text-[10px] text-muted-foreground">(inactive)</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Members of the <span className="font-medium">Exam</span> committee (plus Admin &amp; Coordinator)
                  are the only users who can manage Exam Time Tables.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
              <button data-testid="user-save" onClick={save} className="px-4 py-2 bg-burgundy text-ivory text-sm rounded-sm hover:bg-burgundy-dark">
                {editing ? "Save Changes" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, type = "text", disabled, testid }) {
  return (
    <div>
      <label className="overline block mb-1">{label}</label>
      <input data-testid={testid} disabled={disabled} type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy disabled:bg-ivory-alt disabled:text-muted-foreground" />
    </div>
  );
}
