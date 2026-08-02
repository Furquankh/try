/**
 * IQAC AI Agent — DOM live form-fill controller.
 *
 * The agent produces a `FormFillPlan` (see backend schemas). This module
 * executes that plan against the DOM of the currently-mounted portal form:
 *
 *   1. Navigate the browser to `plan.route` (React-Router-aware).
 *   2. Wait for the first target element to appear (poll + MutationObserver).
 *   3. For each field: focus, type the value character-by-character with a
 *      small delay, dispatch React-compatible input/change events, mark it
 *      "filled", and notify the caller.
 *   4. Never click Save / Submit — the user reviews and commits manually.
 *
 * Controls (Pause / Resume / Stop / Retry) are exposed on the returned
 * controller object so the AIPanel can wire them to buttons.
 *
 *      const ctrl = runFormFill(plan, { navigate, onProgress });
 *      ctrl.pause();  ctrl.resume();  ctrl.stop();  ctrl.retry();
 *      await ctrl.done;
 */

// ---------------------------------------------------------------------------
// Helpers to update React-controlled inputs
// ---------------------------------------------------------------------------

/**
 * React sets its own value setter that bypasses direct `input.value = x`.
 * We must go through the native property setter, then dispatch an "input"
 * event so React re-renders. Same trick for <select> and <textarea>.
 */
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInput(el) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchChange(el) {
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function findEl(selector) {
  try {
    return document.querySelector(selector);
  } catch (_) {
    return null;
  }
}

/**
 * Wait for a selector to become present in the DOM (up to `timeoutMs`).
 * Uses a MutationObserver plus a lightweight interval as a safety net for
 * synchronous DOM updates that observers might miss.
 */
function waitForSelector(selector, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const existing = findEl(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    let done = false;
    const finish = (el) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(el);
    };
    const observer = new MutationObserver(() => {
      const el = findEl(selector);
      if (el) finish(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = setInterval(() => {
      const el = findEl(selector);
      if (el) finish(el);
    }, 120);
    const timeout = setTimeout(() => finish(null), timeoutMs);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Field writers by strategy
// ---------------------------------------------------------------------------

async function typeText(el, value, { charDelayMs = 12, isControl }) {
  el.focus();
  setNativeValue(el, "");
  dispatchInput(el);
  const target = String(value ?? "");
  let current = "";
  for (let i = 0; i < target.length; i += 1) {
    if (isControl.stopped) return "stopped";
    while (isControl.paused && !isControl.stopped) {
      await sleep(80);
    }
    current += target[i];
    setNativeValue(el, current);
    dispatchInput(el);
    // Only sleep between chars, not after the last one.
    if (i < target.length - 1) await sleep(charDelayMs);
  }
  dispatchChange(el);
  el.blur();
  return "ok";
}

async function appendText(el, value, opts) {
  const existing = el.value || "";
  const combined = existing ? `${existing} ${value}` : String(value ?? "");
  return typeText(el, combined, opts);
}

async function selectValue(el, value) {
  // Try to match option by exact value first, then by text.
  const opts = Array.from(el.options || []);
  let match =
    opts.find((o) => String(o.value) === String(value)) ||
    opts.find((o) => (o.textContent || "").trim().toLowerCase() === String(value).trim().toLowerCase());
  if (!match) {
    // Fall back to just setting the value.
    setNativeValue(el, String(value));
  } else {
    setNativeValue(el, match.value);
  }
  dispatchInput(el);
  dispatchChange(el);
  return "ok";
}

async function checkValue(el, value) {
  const shouldCheck = !!value;
  if (el.checked !== shouldCheck) {
    el.click();
  }
  dispatchChange(el);
  return "ok";
}

// ---------------------------------------------------------------------------
// Public controller
// ---------------------------------------------------------------------------

/**
 * @param {object} plan               - FormFillPlan from the backend.
 * @param {object} opts
 * @param {(path: string) => void} opts.navigate  - React-Router navigate function.
 * @param {(update: object) => void} [opts.onProgress]
 * @param {(msg: string) => void}    [opts.onDone]
 * @param {(err: string) => void}    [opts.onError]
 * @returns {object} controller with pause / resume / stop / retry / done
 */
export function runFormFill(plan, opts = {}) {
  const { navigate, onProgress = () => {}, onDone = () => {}, onError = () => {} } = opts;

  const isControl = {
    paused: false,
    stopped: false,
    retryRequested: false,
  };
  const fields = (plan.fields || []).map((f) => ({ ...f, status: "pending" }));
  let currentIndex = -1;

  const emit = () => {
    onProgress({
      index: currentIndex,
      total: fields.length,
      current: currentIndex >= 0 ? fields[currentIndex] : null,
      fields: fields.map((f) => ({ ...f })),
    });
  };

  async function processField(idx) {
    const field = fields[idx];
    field.status = "filling";
    currentIndex = idx;
    emit();

    const el = await waitForSelector(field.selector, { timeoutMs: 6000 });
    if (!el) {
      field.status = "skipped";
      field.note = "field not found";
      emit();
      return;
    }

    let result = "ok";
    try {
      if (field.strategy === "select") {
        result = await selectValue(el, field.value);
      } else if (field.strategy === "check") {
        result = await checkValue(el, field.value);
      } else if (field.strategy === "append") {
        result = await appendText(el, field.value, { charDelayMs: 8, isControl });
      } else {
        const delay = Math.max(4, Math.min(30, Math.floor((plan.field_delay_ms || 12) / 8)));
        result = await typeText(el, field.value, { charDelayMs: delay, isControl });
      }
    } catch (err) {
      field.status = "error";
      field.note = err.message || String(err);
      emit();
      return;
    }

    if (result === "stopped") {
      field.status = "skipped";
      emit();
      return;
    }
    field.status = "filled";
    emit();
  }

  const donePromise = (async () => {
    try {
      // 1. Navigate to the correct form route (only if not already there).
      if (plan.route && navigate && window.location.pathname !== plan.route) {
        navigate(plan.route);
      }
      // 2. Give the router a tick to mount the form.
      await sleep(120);

      // 3. Walk each field.
      let i = 0;
      while (i < fields.length) {
        if (isControl.stopped) break;
        while (isControl.paused && !isControl.stopped) {
          await sleep(80);
        }
        if (isControl.stopped) break;

        await processField(i);

        // Small gap between fields for a natural feel.
        const gap = Math.max(80, Math.min(600, plan.field_delay_ms || 300));
        await sleep(gap);

        if (isControl.retryRequested) {
          isControl.retryRequested = false;
          // Redo current field without advancing i.
          fields[i].status = "pending";
          continue;
        }
        i += 1;
      }

      if (isControl.stopped) {
        onDone("stopped");
      } else {
        onDone("completed");
      }
    } catch (err) {
      onError(err.message || String(err));
    }
  })();

  return {
    pause: () => {
      isControl.paused = true;
      emit();
    },
    resume: () => {
      isControl.paused = false;
      emit();
    },
    stop: () => {
      isControl.stopped = true;
      isControl.paused = false;
    },
    retry: () => {
      isControl.retryRequested = true;
    },
    get state() {
      return {
        paused: isControl.paused,
        stopped: isControl.stopped,
        currentIndex,
        total: fields.length,
        fields: fields.map((f) => ({ ...f })),
      };
    },
    done: donePromise,
  };
}
