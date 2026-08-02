import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, DAYS, DAY_LABELS } from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";

const emptyDailyCell = { subject: "", batch: "", room: "", faculty: "" };
const emptyDailyRow = () => ({
  time_slot: "",
  monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [],
});
const empty = {
  title: "", class_name: "", semester: "", department: "", academic_year: "", date_issued: "",
  daily_rows: [emptyDailyRow()],
};

export default function DailyTimetableForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      api.get(`/timetables/${id}`).then((r) => {
        const d = r.data;
        setForm({
          title: d.title || "",
          class_name: d.class_name || "",
          semester: d.semester || "",
          department: d.department || "",
          academic_year: d.academic_year || "",
          date_issued: d.date_issued || "",
          daily_rows: (d.daily_rows && d.daily_rows.length ? d.daily_rows : [emptyDailyRow()]),
        });
      }).catch((e) => toast.error(formatApiError(e)));
    }
  }, [id, editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const addRow = () => setForm({ ...form, daily_rows: [...form.daily_rows, emptyDailyRow()] });
  const rmRow = (i) => setForm({ ...form, daily_rows: form.daily_rows.filter((_, idx) => idx !== i) });
  const setRowField = (i, field, v) => {
    const next = form.daily_rows.map((r, idx) => idx === i ? { ...r, [field]: v } : r);
    setForm({ ...form, daily_rows: next });
  };
  const addDayEntry = (rowIdx, day) => {
    const next = form.daily_rows.map((r, idx) => {
      if (idx !== rowIdx) return r;
      return { ...r, [day]: [...(r[day] || []), { ...emptyDailyCell }] };
    });
    setForm({ ...form, daily_rows: next });
  };
  const rmDayEntry = (rowIdx, day, entryIdx) => {
    const next = form.daily_rows.map((r, idx) => {
      if (idx !== rowIdx) return r;
      return { ...r, [day]: r[day].filter((_, ei) => ei !== entryIdx) };
    });
    setForm({ ...form, daily_rows: next });
  };
  const setDayEntryField = (rowIdx, day, entryIdx, field, value) => {
    const next = form.daily_rows.map((r, idx) => {
      if (idx !== rowIdx) return r;
      const arr = r[day].map((e, ei) => ei === entryIdx ? { ...e, [field]: value } : e);
      return { ...r, [day]: arr };
    });
    setForm({ ...form, daily_rows: next });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        type: "daily",
        title: form.title,
        class_name: form.class_name,
        semester: form.semester,
        department: form.department,
        academic_year: form.academic_year,
        date_issued: form.date_issued,
        daily_rows: form.daily_rows.filter((r) => r.time_slot || DAYS.some((d) => (r[d] || []).length)),
      };
      const res = editing
        ? await api.put(`/timetables/${id}`, payload)
        : await api.post("/timetables", payload);
      toast.success(editing ? "Daily time table updated." : "Daily time table created.");
      nav(`/daily-timetables/${res.data.id}`);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="overline">Academic Calendar</div>
        <h1 className="font-serif text-4xl">{editing ? "Edit Daily Time Table" : "New Daily Time Table"}</h1>
        <p className="text-sm text-muted-foreground mt-2">Fill the header details, then build the weekly grid — one row per time slot, one column per day.</p>
      </div>

      <div className="paper p-6">
        <div className="overline mb-1">Section</div>
        <h2 className="font-serif text-2xl mb-5">Header</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Title *" full><input data-testid="dtf-title" className={inp} value={form.title} onChange={set("title")} placeholder="T.Y.B.SC.CS Time Table" /></Field>
          <Field label="Department"><input data-testid="dtf-department" className={inp} value={form.department} onChange={set("department")} placeholder="Computer Science" /></Field>
          <Field label="Class *"><input data-testid="dtf-class" className={inp} value={form.class_name} onChange={set("class_name")} placeholder="T.Y.B.Sc.CS" /></Field>
          <Field label="Semester"><input data-testid="dtf-sem" className={inp} value={form.semester} onChange={set("semester")} placeholder="ODD SEMESTER-V" /></Field>
          <Field label="Academic Year"><input data-testid="dtf-ay" className={inp} value={form.academic_year} onChange={set("academic_year")} placeholder="2026-27" /></Field>
          <Field label="Date Issued"><input data-testid="dtf-date" type="date" className={inp} value={form.date_issued} onChange={set("date_issued")} /></Field>
        </div>
      </div>

      <div className="paper p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="overline">Section</div>
            <h2 className="font-serif text-2xl">Weekly Grid — Time Slots × Days</h2>
            <p className="text-xs text-muted-foreground mt-1">Add one or more class entries (subject / batch / room / faculty) per day. Multiple entries in the same slot are combined with "&amp;" on the printed timetable.</p>
          </div>
          <button data-testid="dtf-add-row" onClick={addRow} className="px-3 py-1.5 border border-burgundy text-burgundy rounded-sm hover:bg-burgundy/5 text-xs inline-flex items-center gap-1 flex-shrink-0">
            <Plus size={13}/> Add time slot
          </button>
        </div>

        <div className="space-y-5">
          {form.daily_rows.map((row, ri) => (
            <div key={ri} className="border border-border rounded-sm p-4" data-testid={`dtf-row-${ri}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <label className="overline block mb-1">Time Slot</label>
                  <input data-testid={`dtf-timeslot-${ri}`} className={inp} value={row.time_slot} onChange={(e) => setRowField(ri, "time_slot", e.target.value)} placeholder="8:00 am - 9:00 am" />
                </div>
                <button data-testid={`dtf-row-remove-${ri}`} onClick={() => rmRow(ri)} disabled={form.daily_rows.length <= 1} className="mt-5 text-destructive hover:bg-destructive/10 rounded-sm p-1.5 disabled:opacity-30"><Trash2 size={15}/></button>
              </div>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-6 gap-2 min-w-[900px]">
                  {DAYS.map((day) => (
                    <div key={day} className="bg-ivory-alt/50 border border-border rounded-sm p-2">
                      <div className="overline text-[9px] mb-2 flex items-center justify-between">
                        {DAY_LABELS[day]}
                        <button data-testid={`dtf-add-${day}-${ri}`} onClick={() => addDayEntry(ri, day)} className="text-burgundy hover:bg-burgundy/10 rounded-sm p-0.5"><Plus size={12}/></button>
                      </div>
                      <div className="space-y-2">
                        {(row[day] || []).map((entry, ei) => (
                          <div key={ei} className="bg-white border border-border rounded-sm p-1.5 space-y-1 relative" data-testid={`dtf-${day}-entry-${ri}-${ei}`}>
                            <button onClick={() => rmDayEntry(ri, day, ei)} className="absolute top-1 right-1 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 size={10}/></button>
                            <input className={miniInp} value={entry.subject} onChange={(e) => setDayEntryField(ri, day, ei, "subject", e.target.value)} placeholder="Subject" />
                            <input className={miniInp} value={entry.batch} onChange={(e) => setDayEntryField(ri, day, ei, "batch", e.target.value)} placeholder="Batch (B1)" />
                            <input className={miniInp} value={entry.room} onChange={(e) => setDayEntryField(ri, day, ei, "room", e.target.value)} placeholder="Room (Lab2)" />
                            <input className={miniInp} value={entry.faculty} onChange={(e) => setDayEntryField(ri, day, ei, "faculty", e.target.value)} placeholder="Faculty" />
                          </div>
                        ))}
                        {(!row[day] || row[day].length === 0) && (
                          <div className="text-[10px] text-muted-foreground italic text-center py-2">Empty</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <button data-testid="dtf-save" onClick={save} disabled={saving || !form.title || !form.class_name}
          className="px-5 py-2.5 bg-burgundy text-ivory rounded-sm hover:bg-burgundy-dark text-sm disabled:opacity-50">
          {saving ? "Saving…" : (editing ? "Save Changes" : "Create Daily Time Table")}
        </button>
        <Link to={editing ? `/daily-timetables/${id}` : "/daily-timetables"} className="px-5 py-2.5 text-muted-foreground hover:text-foreground text-sm">Cancel</Link>
      </div>
    </div>
  );
}

const inp = "px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy w-full";
const miniInp = "px-1.5 py-1 border border-border rounded-sm bg-white text-[11px] w-full focus:outline-none focus:border-burgundy";

function Field({ label, children, full }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="overline block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
