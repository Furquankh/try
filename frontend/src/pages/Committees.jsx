import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Plus, Trash2, Edit3, Users as UsersIcon, Power, PowerOff, ShieldCheck } from "lucide-react";

const EMPTY_FORM = { name: "", code: "", description: "", active: true };

export default function Committees() {
  const [committees, setCommittees] = useState([]);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const [membersOpen, setMembersOpen] = useState(false);
  const [membersOf, setMembersOf] = useState(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState("");

  const load = async () => {
    const [c, u] = await Promise.all([api.get("/committees"), api.get("/users")]);
    setCommittees(c.data);
    setUsers(u.data);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const startEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || "",
      code: c.code || "",
      description: c.description || "",
      active: c.active !== false,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required.");
      return;
    }
    try {
      if (editing) {
        await api.put(`/committees/${editing.id}`, {
          name: form.name,
          code: form.code,
          description: form.description,
          active: form.active,
        });
        toast.success("Committee updated.");
      } else {
        await api.post("/committees", {
          name: form.name,
          code: form.code,
          description: form.description,
          active: form.active,
        });
        toast.success("Committee created.");
      }
      setOpen(false);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (c) => {
    if (!window.confirm(`Delete the "${c.name}" committee? This will remove ${(c.members || []).length} member assignment(s).`)) return;
    try {
      await api.delete(`/committees/${c.id}`);
      toast.success("Committee deleted.");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const toggleActive = async (c) => {
    try {
      await api.patch(`/committees/${c.id}/toggle-active`);
      toast.success(`Committee ${c.active ? "deactivated" : "activated"}.`);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const openMembers = (c) => {
    setMembersOf(c);
    setSelectedMemberIds(c.members || []);
    setMemberSearch("");
    setMembersOpen(true);
  };

  const toggleMember = (uid) => {
    setSelectedMemberIds((ids) =>
      ids.includes(uid) ? ids.filter((x) => x !== uid) : [...ids, uid]
    );
  };

  const saveMembers = async () => {
    try {
      await api.put(`/committees/${membersOf.id}/members`, { user_ids: selectedMemberIds });
      toast.success("Members updated.");
      setMembersOpen(false);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const filteredUsers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q)
    );
  }, [users, memberSearch]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline">Administration</div>
          <h1 className="font-serif text-4xl">Committees</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Manage college committees — Exam, IQAC, NSS, Cultural, Sports, Placement and any others you create.
            Membership is independent of Department and can span multiple committees per person.
            The <span className="font-medium text-foreground">Exam</span> committee grants
            Exam Time Table management rights (in addition to Admin &amp; IQAC Coordinator).
          </p>
        </div>
        <button data-testid="committee-new-button" onClick={startNew} className="bg-burgundy text-ivory px-4 py-2.5 rounded-sm text-sm hover:bg-burgundy-dark inline-flex items-center gap-2">
          <Plus size={15} /> New Committee
        </button>
      </div>

      <div className="paper overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ivory-alt border-b border-border">
            <tr className="text-left">
              <th className="px-4 py-3 overline text-[10px]">Name</th>
              <th className="px-4 py-3 overline text-[10px]">Code</th>
              <th className="px-4 py-3 overline text-[10px]">Description</th>
              <th className="px-4 py-3 overline text-[10px]">Members</th>
              <th className="px-4 py-3 overline text-[10px]">Status</th>
              <th className="px-4 py-3 overline text-[10px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {committees.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40" data-testid={`committee-row-${c.code}`}>
                <td className="px-4 py-3 font-medium">
                  {c.name}
                  {c.code === "EXAM" && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-burgundy overline">
                      <ShieldCheck size={11} /> Exam RBAC
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{c.code}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs max-w-md">{c.description || "—"}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => openMembers(c)}
                    data-testid={`committee-members-${c.code}`}
                    className="inline-flex items-center gap-1.5 text-burgundy hover:underline text-xs"
                  >
                    <UsersIcon size={12} /> {(c.members || []).length} member{(c.members || []).length === 1 ? "" : "s"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={`overline text-[10px] px-2 py-0.5 rounded-sm border ${c.active !== false ? "bg-green-50 border-green-200 text-green-700" : "bg-ivory-alt border-border text-muted-foreground"}`}>
                    {c.active !== false ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => toggleActive(c)} data-testid={`committee-toggle-${c.code}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs">
                    {c.active !== false ? <><PowerOff size={12} /> Deactivate</> : <><Power size={12} /> Activate</>}
                  </button>
                  <button onClick={() => startEdit(c)} data-testid={`committee-edit-${c.code}`} className="text-burgundy mr-3 hover:underline inline-flex items-center gap-1 text-xs"><Edit3 size={12} /> Edit</button>
                  <button onClick={() => del(c)} data-testid={`committee-delete-${c.code}`} className="text-destructive hover:underline inline-flex items-center gap-1 text-xs"><Trash2 size={12} /> Delete</button>
                </td>
              </tr>
            ))}
            {committees.length === 0 && (
              <tr><td colSpan={6} className="text-center p-10 text-muted-foreground italic">No committees yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-ivory border border-border rounded-sm p-6 w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
            <div className="overline mb-1">Committee</div>
            <h2 className="font-serif text-2xl mb-5">{editing ? "Edit Committee" : "Create Committee"}</h2>
            <div className="space-y-3">
              <div>
                <label className="overline block mb-1">Name</label>
                <input
                  data-testid="committee-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy"
                  placeholder="e.g. Anti-Ragging"
                />
              </div>
              <div>
                <label className="overline block mb-1">Code</label>
                <input
                  data-testid="committee-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy font-mono uppercase"
                  placeholder="e.g. ANTI_RAGGING"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Short unique identifier. Cannot be reused. Use <span className="font-mono">EXAM</span> for Exam Timetable RBAC.</p>
              </div>
              <div>
                <label className="overline block mb-1">Description</label>
                <textarea
                  data-testid="committee-description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy min-h-[80px]"
                  placeholder="Purpose and remit of this committee…"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="accent-burgundy"
                  data-testid="committee-active"
                />
                Active (inactive committees do not grant permissions and cannot be assigned)
              </label>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
              <button data-testid="committee-save" onClick={save} className="px-4 py-2 bg-burgundy text-ivory text-sm rounded-sm hover:bg-burgundy-dark">
                {editing ? "Save Changes" : "Create Committee"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {membersOpen && membersOf && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setMembersOpen(false)}>
          <div className="bg-ivory border border-border rounded-sm p-6 w-full max-w-2xl my-8 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="overline mb-1">Committee Membership</div>
            <h2 className="font-serif text-2xl mb-1">{membersOf.name} — Assign Members</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Membership never changes a member&#39;s Department. Select any users below to grant/revoke committee membership.
            </p>
            <input
              placeholder="Search users by name, email, or role…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy mb-3"
              data-testid="member-search"
            />
            <div className="flex-1 overflow-y-auto border border-border rounded-sm bg-white">
              <table className="w-full text-sm">
                <thead className="bg-ivory-alt sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 overline text-[10px] w-10">Sel</th>
                    <th className="px-3 py-2 overline text-[10px]">Name</th>
                    <th className="px-3 py-2 overline text-[10px]">Email</th>
                    <th className="px-3 py-2 overline text-[10px]">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const checked = selectedMemberIds.includes(u.id);
                    return (
                      <tr
                        key={u.id}
                        className={`border-b border-border last:border-0 cursor-pointer hover:bg-ivory-alt/40 ${checked ? "bg-ivory-alt/60" : ""}`}
                        onClick={() => toggleMember(u.id)}
                        data-testid={`member-row-${u.id}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(u.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-burgundy"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">{u.name}</td>
                        <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{u.email}</td>
                        <td className="px-3 py-2">
                          <span className="overline text-[10px] px-1.5 py-0.5 bg-ivory-alt border border-border rounded-sm">{u.role}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={4} className="text-center p-8 text-muted-foreground italic text-xs">No users match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="text-xs text-muted-foreground">{selectedMemberIds.length} member{selectedMemberIds.length === 1 ? "" : "s"} selected</div>
              <div className="flex gap-2">
                <button onClick={() => setMembersOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
                <button data-testid="member-save" onClick={saveMembers} className="px-4 py-2 bg-burgundy text-ivory text-sm rounded-sm hover:bg-burgundy-dark">Save Members</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
