// One state machine for Gemini Nano. Every screen reads this state; nothing else decides what "ready" means.
// READY is only set after initialization really succeeded (or, when the SDK has no explicit init step, after a request worked).
export const NANO = Object.freeze({
  CHECKING: "checking", AVAILABLE: "available", INITIALIZING: "initializing", READY: "ready",
  UNAVAILABLE: "unavailable", INIT_FAILED: "init_failed", PROCESSING: "processing", REQUEST_FAILED: "request_failed",
});
export class NanoBusyError extends Error { constructor() { super("A request is already running"); this.code = "busy"; } }

// deps: availability(): Promise<string>, init(onProgress): Promise<boolean|void> (false = no explicit init step), generate(parts): Promise<string>
export function createNanoManager({ availability, init, generate }) {
  let state = NANO.CHECKING, detail = "", raw = "unknown";
  let initP = null, checkP = null, busy = false, initCalls = 0;
  const subs = new Set();
  const set = (s, d = "") => { state = s; detail = d; subs.forEach((f) => { try { f(snapshot()); } catch { /* ignore */ } }); };
  const snapshot = () => ({ state, detail, raw, needsDownload: raw === "downloadable" || raw === "downloading" || raw === "after-download" });
  async function check() {
    if (state === NANO.INITIALIZING || state === NANO.PROCESSING || state === NANO.READY) return state;
    if (checkP) return checkP;
    checkP = (async () => {
      try { raw = String(await availability()); } catch { raw = "unavailable"; }
      if (state === NANO.INITIALIZING || state === NANO.PROCESSING || state === NANO.READY) return state;
      if (raw === "unavailable") set(NANO.UNAVAILABLE, "unsupported"); else set(NANO.AVAILABLE);
      return state;
    })().finally(() => { checkP = null; });
    return checkP;
  }
  function ensureInit(onProgress) {
    if (state === NANO.READY) return Promise.resolve();
    if (initP) return initP; // never start a second initialization
    set(NANO.INITIALIZING);
    initCalls++;
    initP = (async () => {
      try {
        const performed = await init(onProgress);
        if (performed === false) set(NANO.AVAILABLE); else set(NANO.READY);
      } catch (e) { set(NANO.INIT_FAILED, e && e.message ? e.message : "init"); throw e; }
    })().finally(() => { initP = null; });
    return initP;
  }
  async function run(parts, onProgress) {
    if (busy) throw new NanoBusyError(); // no duplicate requests
    busy = true;
    try {
      if (state === NANO.UNAVAILABLE) throw new Error("Gemini Nano is not available");
      await ensureInit(onProgress);
      set(NANO.PROCESSING);
      const text = await generate(parts);
      set(NANO.READY);
      return text;
    } catch (e) {
      if (state === NANO.PROCESSING) set(NANO.REQUEST_FAILED, e && e.message ? e.message : "request");
      throw e;
    } finally { busy = false; }
  }
  return {
    get: snapshot, check, run, ensureInit,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    get initCalls() { return initCalls; }, get busy() { return busy; },
  };
}
