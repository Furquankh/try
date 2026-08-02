import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.get("/audit-logs").then((r) => setLogs(r.data)); }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="overline">Security</div>
        <h1 className="font-serif text-4xl">Audit Trail</h1>
        <p className="text-sm text-muted-foreground mt-2">A chronological log of every action taken across the portal.</p>
      </div>

      <div className="paper overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ivory-alt border-b border-border">
            <tr className="text-left">
              <th className="px-4 py-3 overline text-[10px]">Time</th>
              <th className="px-4 py-3 overline text-[10px]">Actor</th>
              <th className="px-4 py-3 overline text-[10px]">Role</th>
              <th className="px-4 py-3 overline text-[10px]">Action</th>
              <th className="px-4 py-3 overline text-[10px]">Target</th>
              <th className="px-4 py-3 overline text-[10px]">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0 hover:bg-ivory-alt/40" data-testid={`audit-row-${l.id}`}>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">{l.actor_email}</td>
                <td className="px-4 py-3"><span className="overline text-[10px]">{l.actor_role}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-burgundy">{l.action}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.target || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{l.details || "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={6} className="text-center p-10 text-muted-foreground italic">No events recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
