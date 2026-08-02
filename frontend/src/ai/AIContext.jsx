import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  getConfig as apiGetConfig,
  getSession as apiGetSession,
  listSessions as apiListSessions,
  openChatStream,
  renameSession as apiRenameSession,
  sendControl as apiSendControl,
} from "./aiClient";
import { runFormFill } from "./formFill";

/**
 * IQAC AI Agent — global React context.
 *
 * Responsibilities:
 *   - Own the session list, current messages, and streaming status.
 *   - Own panel visibility (open / minimized / maximized).
 *   - Convert incoming SSE `AIEventEnvelope` frames into local state.
 *   - Run form-fill plans when the agent asks for one, tracking progress.
 *   - Provide a clean action API to buttons/inputs elsewhere in the tree.
 */

const AIContext = createContext(null);

const uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

const initialFormFillState = {
  active: false,
  paused: false,
  intent: "",
  formId: "",
  currentIndex: -1,
  total: 0,
  fields: [],
  status: "idle", // idle | running | paused | completed | stopped | error
};

const initialUIState = {
  open: false,
  minimized: false,
  maximized: false,
};

const readStoredUIState = () => {
  try {
    const raw = localStorage.getItem("iqac.ai.ui");
    if (!raw) return initialUIState;
    const parsed = JSON.parse(raw);
    return { ...initialUIState, ...parsed };
  } catch (_) {
    return initialUIState;
  }
};

export function AIProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [ui, setUi] = useState(readStoredUIState);
  const [config, setConfig] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | thinking | tool_running | form_filling | paused | error
  const [errorText, setErrorText] = useState("");
  const [formFill, setFormFill] = useState(initialFormFillState);

  const abortRef = useRef(null);
  const streamingMsgIdRef = useRef(null);
  const formFillCtrlRef = useRef(null);
  const lastRequestRef = useRef(null); // for Retry

  // ------------------------------------------------------------------
  // Persist minimal UI prefs
  // ------------------------------------------------------------------

  useEffect(() => {
    try {
      localStorage.setItem("iqac.ai.ui", JSON.stringify(ui));
    } catch (_) {
      /* ignore */
    }
  }, [ui]);

  // ------------------------------------------------------------------
  // Load config + session list when user logs in
  // ------------------------------------------------------------------

  const refreshSessions = useCallback(async () => {
    try {
      const list = await apiListSessions();
      setSessions(list || []);
    } catch (_) {
      /* not signed in yet, or transient */
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      setMessages([]);
      setCurrentSessionId(null);
      setConfig(null);
      return;
    }
    (async () => {
      try {
        const cfg = await apiGetConfig();
        setConfig(cfg);
      } catch (_) {
        setConfig(null);
      }
      await refreshSessions();
    })();
  }, [user, refreshSessions]);

  // ------------------------------------------------------------------
  // Panel controls
  // ------------------------------------------------------------------

  const openPanel = useCallback(() => {
    setUi((s) => ({ ...s, open: true, minimized: false }));
  }, []);
  const closePanel = useCallback(() => {
    setUi((s) => ({ ...s, open: false, minimized: false }));
  }, []);
  const toggleMinimize = useCallback(() => {
    setUi((s) => ({ ...s, minimized: !s.minimized, maximized: false }));
  }, []);
  const toggleMaximize = useCallback(() => {
    setUi((s) => ({ ...s, maximized: !s.maximized, minimized: false }));
  }, []);

  // ------------------------------------------------------------------
  // Session helpers
  // ------------------------------------------------------------------

  const loadSession = useCallback(async (sid) => {
    if (!sid) {
      setCurrentSessionId(null);
      setMessages([]);
      return;
    }
    try {
      const session = await apiGetSession(sid);
      setCurrentSessionId(session.id);
      setMessages(
        (session.messages || []).map((m) => ({
          id: m.id || uid(),
          role: m.role,
          content: m.content || "",
          toolCalls: m.tool_calls || [],
          toolName: m.tool_name,
          createdAt: m.created_at,
        }))
      );
    } catch (_) {
      setCurrentSessionId(null);
      setMessages([]);
    }
  }, []);

  const newSession = useCallback(async () => {
    setCurrentSessionId(null);
    setMessages([]);
    setErrorText("");
    setStatus("idle");
  }, []);

  const removeSession = useCallback(
    async (sid) => {
      try {
        await apiDeleteSession(sid);
      } catch (_) {
        /* ignore */
      }
      if (sid === currentSessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      await refreshSessions();
    },
    [currentSessionId, refreshSessions]
  );

  const rename = useCallback(
    async (sid, title) => {
      try {
        await apiRenameSession(sid, title);
      } catch (_) {
        /* ignore */
      }
      await refreshSessions();
    },
    [refreshSessions]
  );

  // ------------------------------------------------------------------
  // Form-fill orchestration
  // ------------------------------------------------------------------

  const stopFormFill = useCallback(() => {
    if (formFillCtrlRef.current) {
      formFillCtrlRef.current.stop();
      formFillCtrlRef.current = null;
    }
    setFormFill((s) => ({ ...s, active: false, status: "stopped" }));
  }, []);

  const startFormFill = useCallback(
    (plan) => {
      // If one is already running, cancel it first.
      if (formFillCtrlRef.current) {
        formFillCtrlRef.current.stop();
        formFillCtrlRef.current = null;
      }
      setFormFill({
        active: true,
        paused: false,
        intent: plan.intent || "",
        formId: plan.form_id || "",
        currentIndex: -1,
        total: (plan.fields || []).length,
        fields: (plan.fields || []).map((f) => ({ ...f, status: "pending" })),
        status: "running",
      });
      const ctrl = runFormFill(plan, {
        navigate,
        onProgress: (upd) =>
          setFormFill((s) => ({
            ...s,
            currentIndex: upd.index,
            total: upd.total,
            fields: upd.fields,
            paused: !!upd.current && ctrl.state.paused,
          })),
        onDone: (msg) => {
          setFormFill((s) => ({
            ...s,
            active: false,
            paused: false,
            status: msg === "completed" ? "completed" : "stopped",
          }));
          formFillCtrlRef.current = null;
        },
        onError: (err) => {
          setFormFill((s) => ({ ...s, active: false, status: "error" }));
          setErrorText(err);
          formFillCtrlRef.current = null;
        },
      });
      formFillCtrlRef.current = ctrl;
    },
    [navigate]
  );

  const pauseFormFill = useCallback(() => {
    if (formFillCtrlRef.current) {
      formFillCtrlRef.current.pause();
      setFormFill((s) => ({ ...s, paused: true, status: "paused" }));
    }
  }, []);

  const resumeFormFill = useCallback(() => {
    if (formFillCtrlRef.current) {
      formFillCtrlRef.current.resume();
      setFormFill((s) => ({ ...s, paused: false, status: "running" }));
    }
  }, []);

  const retryCurrentFormField = useCallback(() => {
    if (formFillCtrlRef.current) {
      formFillCtrlRef.current.retry();
    }
  }, []);

  // ------------------------------------------------------------------
  // Chat send + SSE handling
  // ------------------------------------------------------------------

  const buildPageContext = useCallback(
    () => ({
      path: location.pathname,
      route: location.pathname.replace(/^\//, "").replace(/\//g, "_") || "dashboard",
    }),
    [location.pathname]
  );

  const sendMessage = useCallback(
    async (text) => {
      if (!text || !text.trim()) return;
      setErrorText("");

      // Optimistically add the user message.
      const localUserMsg = {
        id: uid(),
        role: "user",
        content: text.trim(),
        toolCalls: [],
      };
      setMessages((prev) => [...prev, localUserMsg]);
      setStatus("thinking");

      const payload = {
        session_id: currentSessionId,
        message: text.trim(),
        page_context: buildPageContext(),
      };
      lastRequestRef.current = payload;

      const controller = new AbortController();
      abortRef.current = controller;

      // Placeholder assistant message we'll stream tokens into.
      const assistantId = uid();
      streamingMsgIdRef.current = assistantId;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", toolCalls: [], streaming: true },
      ]);

      const onEvent = (env) => {
        const type = env.type;
        const data = env.payload || {};
        switch (type) {
          case "session":
            if (data.session_id && data.session_id !== currentSessionId) {
              setCurrentSessionId(data.session_id);
            }
            break;
          case "text_delta":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingMsgIdRef.current
                  ? { ...m, content: (m.content || "") + (data.text || "") }
                  : m
              )
            );
            break;
          case "tool_call_start":
            setStatus("tool_running");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingMsgIdRef.current
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls || []),
                        { id: data.tool_call_id, name: data.name, arguments: data.arguments, status: "running" },
                      ],
                    }
                  : m
              )
            );
            break;
          case "tool_result":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingMsgIdRef.current
                  ? {
                      ...m,
                      toolCalls: (m.toolCalls || []).map((tc) =>
                        tc.id === data.tool_call_id
                          ? { ...tc, status: data.ok ? "done" : "error", result: data.result, error: data.error }
                          : tc
                      ),
                    }
                  : m
              )
            );
            setStatus("thinking");
            break;
          case "form_fill_plan":
            setStatus("form_filling");
            if (data.plan) startFormFill(data.plan);
            break;
          case "message_end":
            // Nothing — final assistant text already accumulated.
            break;
          case "paused":
            setStatus("paused");
            break;
          case "resumed":
            setStatus("thinking");
            break;
          case "cancelled":
            setStatus("idle");
            setMessages((prev) =>
              prev.map((m) => (m.id === streamingMsgIdRef.current ? { ...m, streaming: false, cancelled: true } : m))
            );
            break;
          case "error":
            setStatus("error");
            setErrorText(data.message || "Unknown error");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingMsgIdRef.current ? { ...m, streaming: false, error: data.message } : m
              )
            );
            break;
          case "done":
            setStatus("idle");
            setMessages((prev) =>
              prev.map((m) => (m.id === streamingMsgIdRef.current ? { ...m, streaming: false } : m))
            );
            // Refresh the session list so titles update.
            refreshSessions();
            break;
          case "heartbeat":
          default:
            break;
        }
      };

      try {
        await openChatStream(payload, onEvent, { signal: controller.signal });
      } catch (err) {
        setStatus("error");
        setErrorText(err.message || String(err));
      } finally {
        abortRef.current = null;
      }
    },
    [currentSessionId, buildPageContext, refreshSessions, startFormFill]
  );

  // ------------------------------------------------------------------
  // Turn controls (also drive backend session control)
  // ------------------------------------------------------------------

  const pause = useCallback(async () => {
    if (currentSessionId) {
      try {
        await apiSendControl(currentSessionId, "pause");
      } catch (_) {
        /* ignore */
      }
    }
    if (formFill.active) pauseFormFill();
    setStatus("paused");
  }, [currentSessionId, formFill.active, pauseFormFill]);

  const resume = useCallback(async () => {
    if (currentSessionId) {
      try {
        await apiSendControl(currentSessionId, "resume");
      } catch (_) {
        /* ignore */
      }
    }
    if (formFill.active) resumeFormFill();
    setStatus("thinking");
  }, [currentSessionId, formFill.active, resumeFormFill]);

  const stop = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    if (currentSessionId) {
      try {
        await apiSendControl(currentSessionId, "stop");
      } catch (_) {
        /* ignore */
      }
    }
    if (formFill.active) stopFormFill();
    setStatus("idle");
  }, [currentSessionId, formFill.active, stopFormFill]);

  const retry = useCallback(async () => {
    if (!lastRequestRef.current) return;
    if (abortRef.current) abortRef.current.abort();
    setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && (m.error || m.cancelled))));
    await sendMessage(lastRequestRef.current.message);
  }, [sendMessage]);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (formFillCtrlRef.current) formFillCtrlRef.current.stop();
    };
  }, []);

  const value = useMemo(
    () => ({
      // state
      user,
      config,
      sessions,
      currentSessionId,
      messages,
      status,
      errorText,
      formFill,
      ui,
      // panel controls
      openPanel,
      closePanel,
      toggleMinimize,
      toggleMaximize,
      // sessions
      refreshSessions,
      loadSession,
      newSession,
      removeSession,
      rename,
      // chat
      sendMessage,
      pause,
      resume,
      stop,
      retry,
      // form fill
      pauseFormFill,
      resumeFormFill,
      stopFormFill,
      retryCurrentFormField,
    }),
    [
      user, config, sessions, currentSessionId, messages, status, errorText,
      formFill, ui, openPanel, closePanel, toggleMinimize, toggleMaximize,
      refreshSessions, loadSession, newSession, removeSession, rename,
      sendMessage, pause, resume, stop, retry,
      pauseFormFill, resumeFormFill, stopFormFill, retryCurrentFormField,
    ]
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAI() {
  const ctx = useContext(AIContext);
  if (!ctx) {
    throw new Error("useAI must be called inside <AIProvider>");
  }
  return ctx;
}
