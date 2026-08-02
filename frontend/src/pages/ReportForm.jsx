import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api, ACTIVITY_TYPES, formatApiError } from "@/lib/api";

const empty = {
  activity_number: "", activity_schedule_number: "",
  activity_type: "Co-Curricular", title: "",
  date_of_proposal: "", date_of_activity: "", time: "",
  faculty: "", department_id: "", committee: "", venue: "",
  no_of_participants: 0, activity_for: "",
  coordinator_name: "", coordinator_phone: "", members: "",
  invited_guest: "", brief: "", topic: "",
  objectives: "", methodology: "", outcomes: "",
};

export default function ReportForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);
  const [form, setForm] = useState(empty);
  const [depts, setDepts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/departments").then((r) => setDepts(r.data)).catch(() => {});
    if (editing) {
      api.get(`/reports/${id}`).then((r) => {
        const d = r.data;
        setForm({ ...empty, ...Object.fromEntries(Object.keys(empty).map((k) => [k, d[k] ?? empty[k]])) });
      }).catch((e) => toast.error(formatApiError(e)));
    }
  }, [id, editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (action) => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        no_of_participants: Number(form.no_of_participants) || 0,
        department_id: form.department_id || null,
      };
      const res = editing
        ? await api.put(`/reports/${id}`, payload)
        : await api.post("/reports", payload);
      const reportId = res.data.id;
      if (action === "submit") {
        await api.post(`/reports/${reportId}/workflow`, { action: "submit" });
        toast.success("Report submitted for review.");
      } else {
        toast.success(editing ? "Report updated." : "Draft saved.");
      }
      nav(`/reports/${reportId}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="overline mb-1">IQAC · Departmental Documentation</div>
        <h1 className="font-serif text-4xl text-foreground">
          {editing ? "Edit IQAC Sheet" : "New IQAC Sheet"}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Complete the IQAC sheet as per the format. Save as draft now and upload proofs after creation.
        </p>
      </div>

      <Section title="Identification">
        <Grid>
          <Field label="IQAC Activity Number"><input data-testid="rf-activity-number" className={inp} value={form.activity_number} onChange={set("activity_number")} placeholder="e.g. 01" /></Field>
          <Field label="Schedule Number (Gyankhana)"><input data-testid="rf-schedule-number" className={inp} value={form.activity_schedule_number} onChange={set("activity_schedule_number")} placeholder="2025-26 : 01" /></Field>
          <Field label="Type of Activity *">
            <select data-testid="rf-type" className={inp} value={form.activity_type} onChange={set("activity_type")}>
              {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Title of the Activity *" full><input data-testid="rf-title" className={inp} value={form.title} onChange={set("title")} required placeholder="e.g. National Seminar on Emerging Technologies in Commerce" /></Field>
        </Grid>
      </Section>

      <Section title="Schedule">
        <Grid>
          <Field label="Date of Proposal"><input data-testid="rf-proposal-date" type="date" className={inp} value={form.date_of_proposal} onChange={set("date_of_proposal")} /></Field>
          <Field label="Date of Activity"><input data-testid="rf-activity-date" type="date" className={inp} value={form.date_of_activity} onChange={set("date_of_activity")} /></Field>
          <Field label="Time"><input data-testid="rf-time" className={inp} value={form.time} onChange={set("time")} placeholder="10:00 AM – 1:00 PM" /></Field>
          <Field label="Venue"><input data-testid="rf-venue" className={inp} value={form.venue} onChange={set("venue")} placeholder="Auditorium / Seminar Hall A" /></Field>
        </Grid>
      </Section>

      <Section title="Organising Unit">
        <Grid>
          <Field label="Faculty"><input data-testid="rf-faculty" className={inp} value={form.faculty} onChange={set("faculty")} placeholder="Commerce / Science / Arts" /></Field>
          <Field label="Department">
            <select data-testid="rf-department" className={inp} value={form.department_id || ""} onChange={set("department_id")}>
              <option value="">— Select department —</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Committee / Association / Society"><input data-testid="rf-committee" className={inp} value={form.committee} onChange={set("committee")} placeholder="NSS / Cultural / Sports / etc." /></Field>
          <Field label="No. of Participants"><input data-testid="rf-participants" type="number" min="0" className={inp} value={form.no_of_participants} onChange={set("no_of_participants")} /></Field>
          <Field label="Activity for class / group"><input data-testid="rf-activity-for" className={inp} value={form.activity_for} onChange={set("activity_for")} placeholder="SYBCom / TYBSc-IT" /></Field>
        </Grid>
      </Section>

      <Section title="Coordination">
        <Grid>
          <Field label="Coordinator's Name"><input data-testid="rf-coord-name" className={inp} value={form.coordinator_name} onChange={set("coordinator_name")} /></Field>
          <Field label="Coordinator's Phone"><input data-testid="rf-coord-phone" className={inp} value={form.coordinator_phone} onChange={set("coordinator_phone")} /></Field>
          <Field label="Members / Support" full><textarea data-testid="rf-members" rows={2} className={inp} value={form.members} onChange={set("members")} placeholder="Names of supporting members" /></Field>
          <Field label="Invited Guest (Optional)" full><input data-testid="rf-guest" className={inp} value={form.invited_guest} onChange={set("invited_guest")} placeholder="Name, designation, affiliation" /></Field>
        </Grid>
      </Section>

      <Section title="Narrative">
        <div className="space-y-5">
          <Field label="Brief information about the Activity"><textarea data-testid="rf-brief" rows={3} className={inp} value={form.brief} onChange={set("brief")} /></Field>
          <Field label="Profile / Topic / Subject of the activity"><textarea data-testid="rf-topic" rows={3} className={inp} value={form.topic} onChange={set("topic")} /></Field>
          <Field label="Objectives for conducting the Activity"><textarea data-testid="rf-objectives" rows={3} className={inp} value={form.objectives} onChange={set("objectives")} /></Field>
          <Field label="Methodology (Participative / Experiential / Problem Solving / Other)"><textarea data-testid="rf-methodology" rows={3} className={inp} value={form.methodology} onChange={set("methodology")} /></Field>
          <Field label="Outcomes"><textarea data-testid="rf-outcomes" rows={3} className={inp} value={form.outcomes} onChange={set("outcomes")} /></Field>
        </div>
      </Section>

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <button
          data-testid="rf-save-draft"
          onClick={() => submit("save")}
          disabled={saving || !form.title}
          className="px-5 py-2.5 border border-burgundy text-burgundy rounded-sm hover:bg-burgundy/5 text-sm disabled:opacity-50"
        >
          {editing ? "Save Changes" : "Save as Draft"}
        </button>
        <button
          data-testid="rf-submit"
          onClick={() => submit("submit")}
          disabled={saving || !form.title}
          className="px-5 py-2.5 bg-burgundy text-ivory rounded-sm hover:bg-burgundy-dark text-sm disabled:opacity-50"
        >
          {editing ? "Save &amp; Submit for Review" : "Save &amp; Submit"}
        </button>
        <Link to={editing ? `/reports/${id}` : "/reports"} className="px-5 py-2.5 text-muted-foreground hover:text-foreground text-sm">
          Cancel
        </Link>
      </div>
    </div>
  );
}

const inp = "w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy";

function Section({ title, children }) {
  return (
    <div className="paper p-6">
      <div className="overline mb-1">Section</div>
      <h2 className="font-serif text-2xl text-foreground mb-5">{title}</h2>
      {children}
    </div>
  );
}
function Grid({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}
function Field({ label, children, full }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="overline block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
