import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

const empty = {
  title: "", date: "", department: "", audience: "",
  body: "", activity_name: "", activity_date: "", activity_time: "", venue: "",
  subject: "", proposal_body: "", budget: "",
};

export default function NoticeForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      api.get(`/notices/${id}`).then((r) => {
        const d = r.data;
        setForm({ ...empty, ...Object.fromEntries(Object.keys(empty).map((k) => [k, d[k] ?? empty[k]])) });
      }).catch((e) => toast.error(formatApiError(e)));
    }
  }, [id, editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      const res = editing
        ? await api.put(`/notices/${id}`, form)
        : await api.post("/notices", form);
      toast.success(editing ? "Notice updated." : "Notice created.");
      nav(`/notices/${res.data.id}`);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="overline">Communications</div>
        <h1 className="font-serif text-4xl">{editing ? "Edit Notice" : "New Notice"}</h1>
        <p className="text-sm text-muted-foreground mt-2">Compose a departmental notice. Add optional activity details or a proposal to the Principal.</p>
      </div>

      <div className="paper p-6">
        <div className="overline mb-1">Section</div>
        <h2 className="font-serif text-2xl mb-5">Basic details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Title *" full><input data-testid="nf-title" className={inp} value={form.title} onChange={set("title")} placeholder="e.g. Notice — Innovation and You" /></Field>
          <Field label="Date"><input data-testid="nf-date" type="date" className={inp} value={form.date} onChange={set("date")} /></Field>
          <Field label="Department / Committee"><input data-testid="nf-dept" className={inp} value={form.department} onChange={set("department")} placeholder="Department of Computer Science" /></Field>
          <Field label="Audience"><input data-testid="nf-audience" className={inp} value={form.audience} onChange={set("audience")} placeholder="TYBSc CS students" /></Field>
          <Field label="Notice Body *" full>
            <textarea data-testid="nf-body" rows={6} className={inp} value={form.body} onChange={set("body")}
              placeholder="All the students of TYBSc CS are hereby informed that ..." />
          </Field>
        </div>
      </div>

      <div className="paper p-6">
        <div className="overline mb-1">Optional</div>
        <h2 className="font-serif text-2xl mb-5">Activity details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Activity Name"><input data-testid="nf-act-name" className={inp} value={form.activity_name} onChange={set("activity_name")} /></Field>
          <Field label="Activity Date"><input data-testid="nf-act-date" className={inp} value={form.activity_date} onChange={set("activity_date")} placeholder="e.g. 02nd March 2026" /></Field>
          <Field label="Activity Time"><input data-testid="nf-act-time" className={inp} value={form.activity_time} onChange={set("activity_time")} placeholder="09:00 a.m." /></Field>
          <Field label="Venue"><input data-testid="nf-act-venue" className={inp} value={form.venue} onChange={set("venue")} placeholder="IT Lab II" /></Field>
        </div>
      </div>

      <div className="paper p-6">
        <div className="overline mb-1">Optional</div>
        <h2 className="font-serif text-2xl mb-5">Proposal to the Principal</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Subject" full><input data-testid="nf-subject" className={inp} value={form.subject} onChange={set("subject")} placeholder="Proposal for Conducting ..." /></Field>
          <Field label="Proposal Body" full><textarea data-testid="nf-proposal" rows={5} className={inp} value={form.proposal_body} onChange={set("proposal_body")} /></Field>
          <Field label="Budget (Rs.)"><input data-testid="nf-budget" className={inp} value={form.budget} onChange={set("budget")} placeholder="NIL" /></Field>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <button data-testid="nf-save" onClick={save} disabled={saving || !form.title || !form.body}
          className="px-5 py-2.5 bg-burgundy text-ivory rounded-sm hover:bg-burgundy-dark text-sm disabled:opacity-50">
          {saving ? "Saving…" : (editing ? "Save Changes" : "Create Notice")}
        </button>
        <Link to={editing ? `/notices/${id}` : "/notices"} className="px-5 py-2.5 text-muted-foreground hover:text-foreground text-sm">Cancel</Link>
      </div>
    </div>
  );
}

const inp = "w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy";
function Field({ label, children, full }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="overline block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
