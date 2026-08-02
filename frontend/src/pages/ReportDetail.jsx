import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, FILE_BASE, PROOF_CATEGORIES, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import { Download, Edit3, Upload, Trash2, CheckCircle2, XCircle, RotateCcw, Send, Paperclip } from "lucide-react";

export default function ReportDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [report, setReport] = useState(null);
  const [dept, setDept] = useState(null);
  const [uploadCat, setUploadCat] = useState("proposal");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    const { data } = await api.get(`/reports/${id}`);
    setReport(data);
    if (data.department_id) {
      try {
        const r = await api.get("/departments");
        setDept(r.data.find((d) => d.id === data.department_id) || null);
      } catch {}
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!report) return <div className="text-muted-foreground italic">Loading report…</div>;

  const canEdit = (user.role === "admin") ||
    (report.created_by === user.id && ["draft", "revision_requested"].includes(report.status));

  // Workflow buttons visibility
  const canSubmit = report.created_by === user.id && ["draft", "revision_requested"].includes(report.status);
  const canApprove =
    (user.role === "hod" && report.status === "submitted") ||
    (user.role === "coordinator" && ["submitted", "under_review"].includes(report.status)) ||
    (user.role === "admin" && ["submitted", "under_review"].includes(report.status));
  const canReject = ["hod", "coordinator", "admin"].includes(user.role) &&
    ["submitted", "under_review"].includes(report.status);
  const canRevision = canReject;

  const doAction = async (action) => {
    const note = (action === "reject" || action === "request_revision")
      ? (window.prompt("Add a note (visible in history):", "") || "")
      : "";
    setBusy(true);
    try {
      const { data } = await api.post(`/reports/${id}/workflow`, { action, note });
      setReport(data);
      toast.success(`Action: ${action.replace("_", " ")}`);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("category", uploadCat);
      fd.append("file", file);
      await api.post(`/reports/${id}/proofs`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Proof uploaded.");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const deleteProof = async (stored) => {
    if (!window.confirm("Remove this attachment?")) return;
    setBusy(true);
    try {
      await api.delete(`/reports/${id}/proofs/${stored}`);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const deleteReport = async () => {
    if (!window.confirm("Delete this report permanently?")) return;
    try {
      await api.delete(`/reports/${id}`);
      toast.success("Report deleted.");
      nav("/reports");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const downloadPdf = async () => {
    const res = await api.get(`/reports/${id}/pdf`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `IQAC_${(report.title || "report").replace(/\s+/g, "_")}.pdf`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="overline mb-1">{report.activity_type} · {dept?.name || report.committee || "—"}</div>
          <h1 className="font-serif text-4xl text-foreground leading-tight">{report.title}</h1>
          <div className="flex items-center gap-3 mt-3">
            <StatusBadge status={report.status} />
            <span className="overline text-[10px]">by {report.created_by_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button data-testid="export-pdf-button" onClick={downloadPdf} className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2">
            <Download size={15} /> Export PDF
          </button>
          {canEdit && (
            <Link to={`/reports/${id}/edit`} data-testid="edit-report-button" className="px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt text-sm inline-flex items-center gap-2">
              <Edit3 size={15} /> Edit
            </Link>
          )}
          {(user.role === "admin" || report.created_by === user.id) && (
            <button data-testid="delete-report-button" onClick={deleteReport} className="px-3 py-2 border border-destructive/40 text-destructive rounded-sm hover:bg-destructive/5 text-sm inline-flex items-center gap-2">
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Workflow actions */}
      {(canSubmit || canApprove || canReject || canRevision) && (
        <div className="paper p-4 flex items-center gap-3 flex-wrap">
          <span className="overline">Workflow</span>
          {canSubmit && <WfBtn testid="wf-submit" onClick={() => doAction("submit")} disabled={busy} icon={Send} label="Submit for Review" tone="primary" />}
          {canApprove && <WfBtn testid="wf-approve" onClick={() => doAction("approve")} disabled={busy} icon={CheckCircle2} label="Approve" tone="success" />}
          {canRevision && <WfBtn testid="wf-revision" onClick={() => doAction("request_revision")} disabled={busy} icon={RotateCcw} label="Request Revision" tone="warn" />}
          {canReject && <WfBtn testid="wf-reject" onClick={() => doAction("reject")} disabled={busy} icon={XCircle} label="Reject" tone="danger" />}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailCard title="Identification">
            <Row label="IQAC Activity Number" value={report.activity_number} />
            <Row label="Schedule Number" value={report.activity_schedule_number} />
            <Row label="Type of Activity" value={report.activity_type} />
          </DetailCard>

          <DetailCard title="Schedule &amp; Venue">
            <Row label="Date of Proposal" value={report.date_of_proposal} />
            <Row label="Date of Activity" value={report.date_of_activity} />
            <Row label="Time" value={report.time} />
            <Row label="Venue" value={report.venue} />
            <Row label="No. of Participants" value={report.no_of_participants} />
            <Row label="Activity for" value={report.activity_for} />
          </DetailCard>

          <DetailCard title="Organising Unit">
            <Row label="Faculty" value={report.faculty} />
            <Row label="Department" value={dept?.name} />
            <Row label="Committee" value={report.committee} />
            <Row label="Coordinator" value={`${report.coordinator_name || ""}  ${report.coordinator_phone ? "· " + report.coordinator_phone : ""}`.trim()} />
            <Row label="Members" value={report.members} />
            <Row label="Invited Guest" value={report.invited_guest} />
          </DetailCard>

          <DetailCard title="Narrative">
            <Block label="Brief Information" text={report.brief} />
            <Block label="Topic / Subject" text={report.topic} />
            <Block label="Objectives" text={report.objectives} />
            <Block label="Methodology" text={report.methodology} />
            <Block label="Outcomes" text={report.outcomes} />
          </DetailCard>
        </div>

        <div className="space-y-6">
          {/* Proofs */}
          <div className="paper p-5" data-testid="proofs-panel">
            <div className="overline mb-1">Documents</div>
            <h2 className="font-serif text-2xl mb-4">Proof Attachments</h2>

            {canEdit && (
              <div className="border border-dashed border-border rounded-sm p-3 mb-4">
                <label className="overline block mb-1">Category</label>
                <select className="w-full px-2 py-1.5 border border-border rounded-sm bg-white text-sm mb-2" value={uploadCat} onChange={(e) => setUploadCat(e.target.value)} data-testid="upload-category">
                  {PROOF_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <input
                  ref={fileRef}
                  data-testid="upload-input"
                  type="file"
                  className="block w-full text-xs"
                  onChange={(e) => uploadFile(e.target.files?.[0])}
                />
                <div className="overline text-[10px] mt-2 flex items-center gap-1"><Upload size={11} /> attach proposal, photos, certificates, etc.</div>
              </div>
            )}

            {(!report.proofs || report.proofs.length === 0) ? (
              <p className="text-sm text-muted-foreground italic">No proofs attached yet.</p>
            ) : (
              <ul className="space-y-2">
                {report.proofs.map((p) => (
                  <li key={p.stored} className="flex items-center gap-2 text-sm border border-border rounded-sm px-3 py-2 bg-ivory">
                    <Paperclip size={14} className="text-burgundy" />
                    <div className="flex-1 min-w-0">
                      <a href={`${FILE_BASE}${p.url}`} target="_blank" rel="noreferrer" className="font-medium hover:text-burgundy block truncate">
                        {p.filename}
                      </a>
                      <div className="overline text-[10px]">{p.category} · {Math.round(p.size / 1024)} KB</div>
                    </div>
                    {canEdit && (
                      <button onClick={() => deleteProof(p.stored)} className="text-destructive hover:bg-destructive/10 p-1 rounded-sm" data-testid={`proof-delete-${p.stored}`}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* History */}
          <div className="paper p-5">
            <div className="overline mb-1">Audit Trail</div>
            <h2 className="font-serif text-2xl mb-4">History</h2>
            {(!report.history || report.history.length === 0) ? (
              <p className="text-sm text-muted-foreground italic">No events.</p>
            ) : (
              <ol className="space-y-3">
                {report.history.slice().reverse().map((h, i) => (
                  <li key={i} className="side-rule">
                    <div className="text-sm">
                      <span className="font-medium">{h.action.replace(/_/g, " ")}</span>
                      {h.from && h.to && <span className="text-muted-foreground"> · {h.from} → {h.to}</span>}
                    </div>
                    <div className="overline text-[10px]">{h.by} · {new Date(h.at).toLocaleString()}</div>
                    {h.note && <div className="text-sm italic text-muted-foreground mt-1">"{h.note}"</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailCard({ title, children }) {
  return (
    <div className="paper p-6">
      <div className="overline mb-1">Section</div>
      <h2 className="font-serif text-2xl mb-4">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div>
      <div className="overline text-[10px] mb-0.5">{label}</div>
      <div className="text-sm text-foreground">{value || <span className="text-muted-foreground italic">—</span>}</div>
    </div>
  );
}
function Block({ label, text }) {
  return (
    <div className="md:col-span-2">
      <div className="overline text-[10px] mb-1">{label}</div>
      <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {text || <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}
function WfBtn({ onClick, disabled, icon: Icon, label, tone, testid }) {
  const tones = {
    primary: "bg-burgundy text-ivory hover:bg-burgundy-dark",
    success: "bg-forest text-ivory hover:bg-forest-dark",
    danger: "border border-destructive text-destructive hover:bg-destructive/5",
    warn: "border border-[#9333EA] text-[#9333EA] hover:bg-[#9333EA]/5",
  };
  return (
    <button data-testid={testid} disabled={disabled} onClick={onClick}
      className={`px-3 py-2 rounded-sm text-sm inline-flex items-center gap-2 disabled:opacity-50 ${tones[tone]}`}>
      <Icon size={14} /> {label}
    </button>
  );
}
