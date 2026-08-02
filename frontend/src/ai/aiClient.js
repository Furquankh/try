/**
 * IQAC AI Agent — browser-side API client.
 *
 * This module is deliberately framework-agnostic (no React imports) so it
 * can be unit-tested and reused from anywhere. It exposes:
 *
 *   - REST helpers for session CRUD, config, and pause/resume/stop control
 *   - `openChatStream(payload, onEvent, { signal })` which does the SSE
 *     parsing itself (native EventSource does not support POST bodies).
 *
 * All requests include `credentials: 'include'` so the portal's JWT cookie
 * is forwarded automatically — no manual auth header wiring needed.
 */

const RAW_BACKEND =
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_BACKEND_URL) ||
  (typeof window !== "undefined" && window.__REACT_APP_BACKEND_URL__) ||
  "";
const BASE = `${String(RAW_BACKEND).replace(/\/+$/, "")}/api/ai`;

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch (_) {
      /* ignore */
    }
    const err = new Error(`AI API ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getConfig() {
  return jsonFetch("/config");
}

export async function listSessions() {
  return jsonFetch("/sessions");
}

export async function getSession(sessionId) {
  return jsonFetch(`/sessions/${sessionId}`);
}

export async function createSession(payload = {}) {
  return jsonFetch("/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSession(sessionId) {
  return jsonFetch(`/sessions/${sessionId}`, { method: "DELETE" });
}

export async function renameSession(sessionId, title) {
  return jsonFetch(`/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function sendControl(sessionId, action) {
  return jsonFetch(`/sessions/${sessionId}/control`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

// ---------------------------------------------------------------------------
// SSE stream — POST /api/ai/chat with fetch + manual frame parsing
// ---------------------------------------------------------------------------

/**
 * Open a POST-body SSE stream and dispatch each parsed event to `onEvent`.
 *
 * @param {object} payload           - ChatRequest body
 * @param {(evt: object) => void} onEvent
 * @param {{ signal?: AbortSignal }} opts
 * @returns {Promise<void>}          - resolves when the server closes the stream
 */
export async function openChatStream(payload, onEvent, { signal } = {}) {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch (_) {
      /* ignore */
    }
    onEvent({ type: "error", payload: { message: `HTTP ${res.status}: ${detail}` } });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep;
      // Some servers send "\r\n\r\n" — normalise both.
      while (
        (sep = buffer.indexOf("\n\n")) !== -1 ||
        (sep = buffer.indexOf("\r\n\r\n")) !== -1
      ) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + (buffer[sep] === "\r" ? 4 : 2));
        const parsed = parseFrame(frame);
        if (parsed) onEvent(parsed);
      }
    }
    // Flush any final buffered frame.
    if (buffer.trim()) {
      const parsed = parseFrame(buffer);
      if (parsed) onEvent(parsed);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      onEvent({ type: "cancelled", payload: {} });
      return;
    }
    onEvent({ type: "error", payload: { message: err.message || String(err) } });
  }
}

function parseFrame(rawFrame) {
  const lines = rawFrame.split(/\r?\n/);
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue; // SSE comment — skip
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s/, ""));
    }
    // (We ignore `event:` / `id:` / `retry:` lines — payloads always
    //  carry their own `type` field per our envelope schema.)
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { type: "text_delta", payload: { text: raw } };
  }
}

export const AI_BASE = BASE;
