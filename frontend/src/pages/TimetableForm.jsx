import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, canManageExamTimetable } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2, ShieldAlert } from "lucide-react";

const emptyEntry = { day_date: "", time: "", subject: "" };
const empty = {
  type: "exam",
  title: "External Regular Examination Timetable",
  class_name: "", semester: "", committee: "Examination Committee",
  date_issued: "", entries: [ { ...emptyEntry } ],
};

export default function TimetableForm() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const editing = Boolean(id);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [deptsLoaded, setDeptsLoaded] = useState(false);

  useEffect(() => {
    api.get("/departments").then((r) => setDepartments(r.data)).catch(() => {}).finally(() => setDeptsLoaded(true));
    if (editing) {
      api.get(`/timetables/${id}`).then((r) => {
        const d = r.data;
        setForm({
          type: "exam",
          title: d.title || "",
          class_name: d.class_name || "",
          semester: d.semester || "",
          committee: d.committee || "Examination Committee",
          date_issued: d.date_issued || "",
          entries: (d.entries && d.entries.length ? d.entries : [ { ...emptyEntry } ]),
        });
      }).catch((e) => toast.error(formatApiError(e)));
    }
  }, [id, editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setEntry = (i, k, v) => {
    const next = form.entries.map((e, idx) => idx === i ? { ...e, [k]: v } : e);
    setForm({ ...form, entries: next });
  };
  const addEntry = () => setForm({ ...form, entries: [...form.entries, { ...emptyEntry }] });
  const rmEntry = (i) => setForm({ ...form, entries: form.entries.filter((_, idx) => idx !== i) });

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, entries: form.entries.filter((e) => e.day_date || e.time || e.subject) };
      const res = editing
        ? await api.put(`/timetables/${id}`, payload)
        : await api.post("/timetables", payload);
      toast.success(editing ? "Timetable updated." : "Timetable created.");
      nav(`/timetables/${res.data.id}`);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  if (deptsLoaded && !canManageExamTimetable(user, departments)) {
    return (
      <div className="paper p-10 text-center max-w-lg mx-auto" data-testid="tt-permission-denied">
        <ShieldAlert size={28} className="mx-auto mb-3 text-destructive" strokeWidth={1.4} />
        <h2 className="font-serif text-2xl mb-2">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">
          Only the Exam department, Coordinators, and the Principal can create or edit Exam Time Tables.
        </p>
        <Link to="/timetables" className="inline-block mt-5 text-sm text-burgundy hover:underline">← Back to Time Tables</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="overline">Academic Calendar</div>
        <h1 className="font-serif text-4xl">{editing ? "Edit Timetable" : "New Timetable"}</h1>
        <p className="text-sm text-muted-foreground mt-2">Add class, semester and each day/time/subject row.</p>
      </div>

      <div className="paper p-6">
        <div className="overline mb-1">Section</div>
        <h2 className="font-serif text-2xl mb-5">Header</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Title *" full><input data-testid="tf-title" className={inp} value={form.title} onChange={set("title")} /></Field>
          <Field label="Class *"><input data-testid="tf-class" className={inp} value={form.class_name} onChange={set("class_name")} placeholder="FY BSc CS" /></Field>
          <Field label="Semester"><input data-testid="tf-sem" className={inp} value={form.semester} onChange={set("semester")} placeholder="I" /></Field>
          <Field label="Committee"><input data-testid="tf-committee" className={inp} value={form.committee} onChange={set("committee")} /></Field>
          <Field label="Date Issued"><input data-testid="tf-date" type="date" className={inp} value={form.date_issued} onChange={set("date_issued")} /></Field>
        </div>
      </div>

      <div className="paper p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="overline">Section</div>
            <h2 className="font-serif text-2xl">Schedule Entries</h2>
          </div>
          <button data-testid="tf-add-entry" onClick={addEntry} className="px-3 py-1.5 border border-burgundy text-burgundy rounded-sm hover:bg-burgundy/5 text-xs inline-flex items-center gap-1">
            <Plus size={13}/> Add row
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-2 overline text-[10px] px-1">
            <div className="col-span-4">Day / Date</div>
            <div className="col-span-3">Time</div>
            <div className="col-span-4">Subject</div>
            <div className="col-span-1"></div>
          </div>
          {form.entries.map((e, i) => (
            <div key={i} className="grid grid-cols-12 gap-2" data-testid={`tf-row-${i}`}>
              <input data-testid={`tf-daydate-${i}`} className={inp + " col-span-4"} value={e.day_date} onChange={(ev) => setEntry(i, "day_date", ev.target.value)} placeholder="Friday, 06/03/2026" />
              <input data-testid={`tf-time-${i}`} className={inp + " col-span-3"} value={e.time} onChange={(ev) => setEntry(i, "time", ev.target.value)} placeholder="8:30 to 10:30 am" />
              <input data-testid={`tf-subject-${i}`} className={inp + " col-span-4"} value={e.subject} onChange={(ev) => setEntry(i, "subject", ev.target.value)} placeholder="Major: Design & Analysis of Algorithms" />
              <button data-testid={`tf-remove-${i}`} onClick={() => rmEntry(i)} disabled={form.entries.length <= 1} className="col-span-1 text-destructive hover:bg-destructive/10 rounded-sm disabled:opacity-30"><Trash2 size={14} className="mx-auto"/></button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <button data-testid="tf-save" onClick={save} disabled={saving || !form.title || !form.class_name}
          className="px-5 py-2.5 bg-burgundy text-ivory rounded-sm hover:bg-burgundy-dark text-sm disabled:opacity-50">
          {saving ? "Saving…" : (editing ? "Save Changes" : "Create Timetable")}
        </button>
        <Link to={editing ? `/timetables/${id}` : "/timetables"} className="px-5 py-2.5 text-muted-foreground hover:text-foreground text-sm">Cancel</Link>
      </div>
    </div>
  );
}

const inp = "px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy w-full";
function Field({ label, children, full }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="overline block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
