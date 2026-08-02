import React from "react";
import { Bot, User as UserIcon, Wrench, Loader2, Check, AlertTriangle } from "lucide-react";

/**
 * Very small Markdown-lite renderer that is safe (no dangerouslySetInnerHTML).
 * Supports paragraphs, bullet lists, inline `code`, **bold**, and *italic*.
 * Deliberately minimal — the assistant is instructed to keep replies short.
 */
function renderInline(text) {
  const parts = [];
  let rest = text;
  const patterns = [
    { rx: /\*\*([^*]+)\*\*/, tag: "strong" },
    { rx: /\*([^*]+)\*/, tag: "em" },
    { rx: /`([^`]+)`/, tag: "code" },
  ];
  while (rest.length) {
    let earliest = null;
    for (const p of patterns) {
      const m = rest.match(p.rx);
      if (m && (earliest === null || m.index < earliest.m.index)) {
        earliest = { p, m };
      }
    }
    if (!earliest) {
      parts.push(rest);
      break;
    }
    if (earliest.m.index > 0) parts.push(rest.slice(0, earliest.m.index));
    const Tag = earliest.p.tag;
    parts.push(
      React.createElement(
        Tag,
        { key: `${Tag}-${parts.length}`, className: Tag === "code" ? "px-1 py-0.5 rounded bg-ivory-alt border border-border text-[12px] font-mono" : undefined },
        earliest.m[1]
      )
    );
    rest = rest.slice(earliest.m.index + earliest.m[0].length);
  }
  return parts;
}

function MarkdownLite({ text }) {
  if (!text) return null;
  const blocks = text.split(/\n\n+/);
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {blocks.map((blk, i) => {
        const lines = blk.split(/\n/);
        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(blk)}
          </p>
        );
      })}
    </div>
  );
}

function ToolCallChip({ tc }) {
  const IconEl =
    tc.status === "running" ? Loader2 : tc.status === "error" ? AlertTriangle : Check;
  const iconClass =
    tc.status === "running"
      ? "animate-spin text-burgundy"
      : tc.status === "error"
      ? "text-destructive"
      : "text-green-700";
  return (
    <div
      className="mt-2 inline-flex items-center gap-1.5 text-[11px] px-2 py-1 border border-border rounded-sm bg-ivory-alt"
      data-testid={`ai-tool-${tc.name}`}
    >
      <Wrench size={11} className="text-muted-foreground" />
      <span className="font-mono">{tc.name}</span>
      <IconEl size={12} className={iconClass} />
      {tc.error && <span className="text-destructive">— {tc.error}</span>}
    </div>
  );
}

export default function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  const isTool = msg.role === "tool";

  if (isTool) {
    // Tool messages are already surfaced as chips on the parent assistant
    // message; suppress the standalone bubble.
    return null;
  }

  return (
    <div
      className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={`ai-msg-${msg.role}`}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-burgundy text-ivory flex items-center justify-center">
          <Bot size={14} />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-md px-3 py-2 border ${
          isUser
            ? "bg-burgundy text-ivory border-burgundy-dark"
            : "bg-white border-border text-foreground"
        }`}
      >
        {msg.content ? (
          <MarkdownLite text={msg.content} />
        ) : msg.streaming && !(msg.toolCalls || []).length ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
            <Loader2 size={12} className="animate-spin" /> Thinking…
          </span>
        ) : null}
        {(msg.toolCalls || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.toolCalls.map((tc) => (
              <ToolCallChip key={tc.id} tc={tc} />
            ))}
          </div>
        )}
        {msg.error && (
          <div className="mt-2 text-[11px] text-destructive flex items-center gap-1">
            <AlertTriangle size={11} /> {msg.error}
          </div>
        )}
        {msg.cancelled && (
          <div className="mt-2 text-[11px] text-muted-foreground italic">Cancelled.</div>
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-ivory-alt border border-border text-foreground flex items-center justify-center">
          <UserIcon size={14} />
        </div>
      )}
    </div>
  );
}
