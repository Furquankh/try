import React from "react";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/api";

export default function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.draft;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded-sm"
      style={{ backgroundColor: c.bg + "15", color: c.bg, border: `1px solid ${c.bg}40` }}
    >
      <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: c.bg }} />
      {STATUS_LABEL[status] || status}
    </span>
  );
}
