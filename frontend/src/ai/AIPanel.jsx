import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Send, X, Minus, Maximize2, Minimize2, MessageSquarePlus, History,
  Pause, Play, Square, RotateCcw, Loader2, Sparkles, Trash2, ChevronDown
} from "lucide-react";
import { useAI } from "./AIContext";
import MessageBubble from "./MessageBubble";

const DEFAULT_POS = { x: null, y: null };

export default function AIPanel() {
  const {
    ui, closePanel, toggleMinimize, toggleMaximize,
    sessions, currentSessionId, loadSession, newSession, removeSession,
    messages, status, errorText, formFill,
    sendMessage, pause, resume, stop, retry, refreshSessions,
    pauseFormFill, resumeFormFill, stopFormFill, retryCurrentFormField,
    config,
  } = useAI();

  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pos, setPos] = useState(DEFAULT_POS);
  const dragRef = useRef(null);
  const dragState = useRef({ active: false, offX: 0, offY: 0 });
  const messagesEndRef = useRef(null);

  // Autoscroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, formFill.currentIndex]);

  // Refresh sessions when history dropdown opens
  useEffect(() => {
    if (historyOpen) refreshSessions();
  }, [historyOpen, refreshSessions]);

  const onDragStart = (e) => {
    if (ui.maximized) return;
    const el = dragRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = {
      active: true,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    };
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd, { once: true });
  };
  const onDragMove = (e) => {
    if (!dragState.current.active) return;
    setPos({
      x: Math.max(8, e.clientX - dragState.current.offX),
      y: Math.max(8, e.clientY - dragState.current.offY),
    });
  };
  const onDragEnd = () => {
    dragState.current.active = false;
    document.removeEventListener("mousemove", onDragMove);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const busy = status === "thinking" || status === "tool_running" || status === "form_filling";
  const paused = status === "paused" || formFill.paused;

  const styleWhenFloating = useMemo(() => {
    if (ui.maximized) return {};
    if (pos.x !== null && pos.y !== null) return { left: pos.x, top: pos.y, right: "auto", bottom: "auto" };
    return {};
  }, [ui.maximized, pos]);

  if (!ui.open) return null;

  return (
    <div
      className={`fixed z-[70] bg-ivory border border-border rounded-md shadow-2xl flex flex-col ${
        ui.maximized ? "inset-4" : ui.minimized ? "bottom-24 right-6 w-80 h-14" : "bottom-24 right-6 w-[420px] h-[600px]"
      }`}
      style={styleWhenFloating}
      data-testid="ai-panel"
    >
      {/* Header */}
      <div
        ref={dragRef}
        onMouseDown={onDragStart}
        className="flex items-center justify-between px-3 py-2 bg-burgundy text-ivory rounded-t-md cursor-move select-none"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={15} />
          <div className="font-serif text-sm leading-none">Aarya <span className="opacity-70 text-[11px]">— Portal Assistant</span></div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleMinimize} title={ui.minimized ? "Expand" : "Minimize"} className="p-1 hover:bg-white/10 rounded" data-testid="ai-minimize">
            <Minus size={13} />
          </button>
          <button onClick={toggleMaximize} title={ui.maximized ? "Restore" : "Maximize"} className="p-1 hover:bg-white/10 rounded" data-testid="ai-maximize">
            {ui.maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button onClick={closePanel} title="Close" className="p-1 hover:bg-white/10 rounded" data-testid="ai-close">
            <X size={14} />
          </button>
        </div>
      </div>

      {!ui.minimized && (
        <>
          {/* Session bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-ivory-alt text-xs">
            <button onClick={newSession} className="inline-flex items-center gap-1 text-burgundy hover:underline" data-testid="ai-new-session">
              <MessageSquarePlus size={12} /> New
            </button>
            <div className="relative ml-auto">
              <button onClick={() => setHistoryOpen((v) => !v)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" data-testid="ai-history">
                <History size={12} /> History <ChevronDown size={11} />
              </button>
              {historyOpen && (
                <div className="absolute right-0 top-6 w-72 max-h-80 overflow-y-auto bg-white border border-border rounded-sm shadow-lg z-10">
                  {sessions.length === 0 && (
                    <div className="px-3 py-4 text-muted-foreground italic">No previous conversations.</div>
                  )}
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`px-3 py-2 border-b border-border last:border-0 hover:bg-ivory-alt cursor-pointer flex items-start justify-between gap-2 ${s.id === currentSessionId ? "bg-ivory-alt" : ""}`}
                      onClick={() => { loadSession(s.id); setHistoryOpen(false); }}
                      data-testid={`ai-session-${s.id}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium">{s.title || "Conversation"}</div>
                        <div className="text-[10px] text-muted-foreground">{s.message_count} msg · {(s.updated_at || "").slice(0, 16).replace("T", " ")}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                        className="text-destructive opacity-60 hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-white" data-testid="ai-messages">
            {messages.length === 0 && !busy && (
              <div className="text-center text-muted-foreground text-xs py-10">
                <Sparkles size={20} className="mx-auto mb-2 text-burgundy" />
                <div className="font-serif text-base text-foreground mb-1">Hi, I&apos;m Aarya.</div>
                <p className="px-4">Ask me about your IQAC reports, notices, timetables, or say <em>&#34;draft a new IQAC report about…&#34;</em> and I&apos;ll fill the form live.</p>
              </div>
            )}
            {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="ai-status">
                <Loader2 size={12} className="animate-spin text-burgundy" />
                {status === "tool_running" ? "Running tool…" : status === "form_filling" ? "Filling form…" : "Thinking…"}
              </div>
            )}
            {errorText && (
              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1">{errorText}</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Form-fill strip */}
          {formFill.active && (
            <div className="px-3 py-2 border-t border-border bg-ivory-alt" data-testid="ai-formfill-strip">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span className="truncate mr-2">Filling: <span className="font-medium text-foreground">{formFill.intent || formFill.formId}</span></span>
                <span>{Math.max(0, formFill.currentIndex + 1)}/{formFill.total}</span>
              </div>
              <div className="h-1.5 bg-white border border-border rounded-sm overflow-hidden">
                <div
                  className="h-full bg-burgundy transition-all"
                  style={{ width: `${formFill.total ? Math.min(100, ((formFill.currentIndex + 1) / formFill.total) * 100) : 0}%` }}
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                {!formFill.paused ? (
                  <button onClick={pauseFormFill} className="px-2 py-1 border border-border rounded-sm text-[11px] inline-flex items-center gap-1 hover:bg-white" data-testid="ai-ff-pause">
                    <Pause size={11} /> Pause
                  </button>
                ) : (
                  <button onClick={resumeFormFill} className="px-2 py-1 border border-border rounded-sm text-[11px] inline-flex items-center gap-1 hover:bg-white" data-testid="ai-ff-resume">
                    <Play size={11} /> Resume
                  </button>
                )}
                <button onClick={retryCurrentFormField} className="px-2 py-1 border border-border rounded-sm text-[11px] inline-flex items-center gap-1 hover:bg-white" data-testid="ai-ff-retry">
                  <RotateCcw size={11} /> Retry field
                </button>
                <button onClick={stopFormFill} className="px-2 py-1 border border-destructive/30 text-destructive rounded-sm text-[11px] inline-flex items-center gap-1 hover:bg-destructive/5" data-testid="ai-ff-stop">
                  <Square size={11} /> Stop
                </button>
                <span className="ml-auto text-[10px] text-muted-foreground italic">I won&apos;t save — review and click Save yourself.</span>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border p-2 bg-ivory">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask Aarya anything about the portal…"
                rows={2}
                className="flex-1 resize-none px-2.5 py-2 border border-border rounded-sm text-sm bg-white focus:outline-none focus:border-burgundy"
                data-testid="ai-input"
                disabled={busy && !paused}
              />
              <div className="flex flex-col gap-1">
                {busy && !paused && (
                  <button onClick={pause} className="p-1.5 border border-border rounded-sm hover:bg-ivory-alt" title="Pause" data-testid="ai-pause">
                    <Pause size={13} />
                  </button>
                )}
                {paused && (
                  <button onClick={resume} className="p-1.5 border border-border rounded-sm hover:bg-ivory-alt" title="Resume" data-testid="ai-resume">
                    <Play size={13} />
                  </button>
                )}
                {busy && (
                  <button onClick={stop} className="p-1.5 border border-destructive/30 text-destructive rounded-sm hover:bg-destructive/5" title="Stop" data-testid="ai-stop">
                    <Square size={13} />
                  </button>
                )}
                {!busy && messages.some((m) => m.error || m.cancelled) && (
                  <button onClick={retry} className="p-1.5 border border-border rounded-sm hover:bg-ivory-alt" title="Retry" data-testid="ai-retry">
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  onClick={send}
                  disabled={busy || !draft.trim()}
                  className="p-1.5 bg-burgundy text-ivory rounded-sm hover:bg-burgundy-dark disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Send"
                  data-testid="ai-send"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 px-1 flex items-center justify-between">
              <span>Provider: {config?.provider || "gemini"} · {config?.model || ""}</span>
              <span>Enter to send · Shift+Enter for newline</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
