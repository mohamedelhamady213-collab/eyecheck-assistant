// Session history. Default: tab-only (sessionStorage). Persistent (localStorage) only after explicit consent.
// Only a tiny thumbnail and the report are stored, never the full photos.
export const KEY = "eyecheck.history.v2", CONSENT_KEY = "eyecheck.persist.consent";
export const MAX_ENTRIES = 20;
export const TTL_DAYS = 30;
const DAY = 86400000;

export function createHistory({ session, local, now = () => Date.now() }) {
  const persistent = () => local.getItem(CONSENT_KEY) === "1";
  const store = () => (persistent() ? local : session);
  function read() {
    let list = [];
    try { list = JSON.parse(store().getItem(KEY) || "[]"); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    const fresh = list.filter((e) => e && typeof e.at === "string" && now() - Date.parse(e.at) < TTL_DAYS * DAY);
    if (fresh.length !== list.length) write(fresh);
    return fresh;
  }
  function write(list) { try { store().setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES))); } catch { /* quota */ } }
  return {
    isPersistent: persistent,
    list: read,
    add(entry) { const l = read(); l.unshift({ id: "s" + now().toString(36) + Math.random().toString(36).slice(2, 6), ...entry }); write(l); return l[0].id; },
    remove(id) { write(read().filter((e) => e.id !== id)); },
    clear() { session.removeItem(KEY); local.removeItem(KEY); },
    setPersistent(on) {
      const cur = read();
      if (on) { local.setItem(CONSENT_KEY, "1"); write(cur); session.removeItem(KEY); }
      else { local.removeItem(CONSENT_KEY); const l = cur; session.setItem(KEY, JSON.stringify(l)); local.removeItem(KEY); }
    },
  };
}
// Compare two stored sessions. Wording must never imply progression.
export function compare(a, b) {
  const rows = [];
  const push = (k, x, y) => rows.push({ key: k, a: x, b: y, same: JSON.stringify(x) === JSON.stringify(y) });
  push("urgency", a.report.urgency, b.report.urgency);
  push("quality", a.report.image_quality.overall, b.report.image_quality.overall);
  for (const k of ["eye", "onset", "pain", "redness", "blur", "light", "flashes", "suddenLoss", "injury", "diabetes"]) push(k, a.summary && a.summary[k], b.summary && b.summary[k]);
  push("history", a.summary && a.summary.history, b.summary && b.summary.history);
  return rows;
}
