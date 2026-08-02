import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Save, RotateCcw, FileSignature } from "lucide-react";

const DEFAULT = [
  { label: "Prepared By",     name: "",                       role: "Member, Gyankhana Committee" },
  { label: "Reviewed By",     name: "",                       role: "Coordinator, Gyankhana Committee" },
  { label: "Recommended By",  name: "Mr. Prathmesh Vhatkar",  role: "Coordinator, IQAC" },
  { label: "Approved By",     name: "Dr. Matsubrata Laha",    role: "I/c Principal, RTCCS, Kharghar" },
];

export default function Settings() {
  const [sigs, setSigs] = useState(DEFAULT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/settings/pdf-footer")
      .then((r) => setSigs(r.data.signatures || DEFAULT))
      .catch(() => {});
  }, []);

  const update = (idx, field, value) => {
    const next = sigs.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    setSigs(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/pdf-footer", { signatures: sigs });
      toast.success("Footer signatures updated. New PDF exports will use these values.");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const reset = () => setSigs(DEFAULT);

  return (
    <div className="space-y-8">
      <div>
        <div className="overline">Administration</div>
        <h1 className="font-serif text-4xl">PDF Report Settings</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          The signature block prints on the <span className="font-medium text-foreground">last page</span> of every
          exported Activity Sheet PDF. Update the four sign-off roles below — changes apply to all future PDF
          exports immediately.
        </p>
      </div>

      <div className="paper p-6">
        <div className="overline mb-1">Footer</div>
        <h2 className="font-serif text-2xl mb-1 flex items-center gap-2">
          <FileSignature size={20} className="text-burgundy" /> Signature Block (4 columns)
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Each column appears with a signature line, the role label, the named signatory, and their designation.
          Leave <em>Name</em> blank for committee roles that are signed in person.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sigs.map((s, i) => (
            <div key={i} className="paper p-5 border-t-2 border-t-burgundy" data-testid={`sig-${i}`}>
              <div className="overline mb-3">Column {i + 1}</div>
              <div className="space-y-3">
                <div>
                  <label className="overline block mb-1">Role label</label>
                  <input
                    data-testid={`sig-label-${i}`}
                    value={s.label}
                    onChange={(e) => update(i, "label", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy"
                    placeholder="e.g. Prepared By"
                  />
                </div>
                <div>
                  <label className="overline block mb-1">Name of Signatory</label>
                  <input
                    data-testid={`sig-name-${i}`}
                    value={s.name}
                    onChange={(e) => update(i, "name", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy"
                    placeholder="e.g. Dr. Matsubrata Laha"
                  />
                </div>
                <div>
                  <label className="overline block mb-1">Designation / Role</label>
                  <input
                    data-testid={`sig-role-${i}`}
                    value={s.role}
                    onChange={(e) => update(i, "role", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-burgundy"
                    placeholder="e.g. I/c Principal, RTCCS"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-border flex items-center gap-3">
          <button
            data-testid="settings-save"
            onClick={save}
            disabled={saving}
            className="bg-burgundy text-ivory px-5 py-2.5 rounded-sm text-sm hover:bg-burgundy-dark disabled:opacity-60 inline-flex items-center gap-2"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            data-testid="settings-reset"
            onClick={reset}
            className="px-4 py-2.5 border border-border rounded-sm text-sm hover:bg-ivory-alt inline-flex items-center gap-2"
          >
            <RotateCcw size={14} /> Reset to defaults
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div className="paper p-6">
        <div className="overline mb-1">Preview</div>
        <h2 className="font-serif text-2xl mb-4">How it will appear at the end of the report</h2>
        <div className="border-t border-border pt-6">
          <div className="grid grid-cols-4 gap-3">
            {sigs.map((s, i) => (
              <div key={i} className="text-center">
                <div className="h-10" />
                <div className="border-t border-[#7a6b5a] mb-2" />
                <div className="font-serif font-semibold text-sm text-foreground">{s.label || "—"}</div>
                <div className="font-serif text-sm text-foreground mt-1">{s.name || <span className="italic text-muted-foreground">(handwritten)</span>}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.role || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
