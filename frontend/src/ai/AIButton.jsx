import React from "react";
import { Sparkles } from "lucide-react";
import { useAI } from "./AIContext";

/**
 * Floating bottom-right entry point for the Personal AI Agent.
 * Matches the portal's burgundy/ivory theme; shows a subtle status dot
 * when the agent is thinking or running a tool.
 */
export default function AIButton() {
  const { user, ui, openPanel, status, formFill } = useAI();
  if (!user) return null;
  if (ui.open && !ui.minimized) return null;

  const busy = status === "thinking" || status === "tool_running" || status === "form_filling" || formFill.active;

  return (
    <button
      onClick={openPanel}
      className="fixed z-[60] bottom-6 right-6 w-14 h-14 rounded-full bg-burgundy text-ivory shadow-lg hover:bg-burgundy-dark hover:scale-105 transition-transform flex items-center justify-center"
      title="Ask Aarya — your portal AI assistant"
      data-testid="ai-launcher"
    >
      <Sparkles size={22} />
      {busy && (
        <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-burgundy animate-pulse" />
      )}
    </button>
  );
}
