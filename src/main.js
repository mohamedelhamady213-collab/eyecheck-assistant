import "./style.css";
import * as models from "./firebase.js";
import { createEngines } from "./engines.js";
import { t, setLang, getLang, translateDom } from "./i18n.js";
import { QUESTIONS, QUESTION_COUNT, TOTAL_STEPS, validate, buildSummary, summaryToText, sanitizeText, MAX_TEXT } from "./symptoms.js";
import { triage as runTriage } from "./safety.js";
import { checkFile, scaleSize, assess, OUT_MAX } from "./imagequality.js";
import { buildPrompt, runScreening, runCloudWithConsent, validateReport, AiError, NOT_ASSESSABLE } from "./ai.js";
import { createHistory, compare } from "./history.js";
import { doctorSummary } from "./report.js";
import { createNanoManager, NANO } from "./nanostate.js";
import { DEMOS, demoContext } from "./demo.js";

const baseEngines = createEngines(models);
// One Gemini Nano state for the whole app. Screening goes through it, so the badge can never disagree with what actually happened.
const nano = createNanoManager({ availability: models.nanoAvailability, init: (cb) => baseEngines.initDevice(cb), generate: (p) => baseEngines.generateDevice(p) });
const engines = { ...baseEngines, nanoState: () => nano.check(), runDevice: (p, o) => nano.run(p, o) };
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const history = createHistory({ session: sessionStorage, local: localStorage });

const state = { step: 1, photos: { left: null, right: null }, answers: { history: [], text: "" }, q: 0, triage: null, ctx: null, cloudLog: [], busy: false };

// ---------- theme + language ----------
const root = document.documentElement;
const prefersDark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
root.dataset.theme = localStorage.getItem("theme") || (prefersDark ? "dark" : "light");
$("theme").addEventListener("click", () => { root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"; localStorage.setItem("theme", root.dataset.theme); });
function applyLang(l) {
  setLang(l); localStorage.setItem("lang", getLang());
  root.lang = getLang(); root.dir = getLang() === "ar" ? "rtl" : "ltr";
  $("lang").textContent = getLang() === "ar" ? "EN" : "عربي";
  $("lang").setAttribute("aria-label", getLang() === "ar" ? "Switch to English" : "التبديل إلى العربية");
  translateDom(); renderAll();
}
$("lang").addEventListener("click", () => applyLang(getLang() === "ar" ? "en" : "ar"));

// ---------- engine badge ----------
function renderNano() {
  const { state: st, detail, needsDownload } = nano.get();
  const b = $("engineStatus"), h = $("engineHint");
  const good = [NANO.AVAILABLE, NANO.INITIALIZING, NANO.READY, NANO.PROCESSING].includes(st);
  b.className = "badge " + (good ? "badge-device" : "badge-fallback"); b.dataset.state = st;
  b.textContent = t(st === NANO.AVAILABLE && needsDownload ? "nano_download" : "nano_" + st);
  const hint = st === NANO.UNAVAILABLE ? t("nano_h_unavailable") : st === NANO.INIT_FAILED ? t("nano_h_init_failed", { err: detail }) : st === NANO.REQUEST_FAILED ? t("nano_h_request_failed", { err: detail }) : st === NANO.AVAILABLE && needsDownload ? t("nano_h_download") : "";
  h.textContent = hint; h.hidden = !hint;
}
nano.subscribe(renderNano);
const checkNano = () => nano.check();

// ---------- stepper ----------
function setStep(n, scroll = true) {
  state.step = n;
  for (let i = 1; i <= 4; i++) $("p" + i).hidden = i !== n;
  document.querySelectorAll("#stepper li").forEach((li) => {
    const s = +li.dataset.step; li.classList.toggle("on", s === n); li.classList.toggle("done", s < n);
    if (s === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
  if (!scroll) return;
  const h = $("p" + n).querySelector("h3"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  $("scan").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function showMsg(node, key, vars, info) { node.textContent = key ? t(key, vars) : ""; node.className = "msg" + (info ? " info" : ""); node.hidden = !key; }

// ---------- photos ----------
function slot(eye) { return document.querySelector(`.slot[data-eye=${eye}]`); }
function setPhoto(eye, p) {
  state.photos[eye] = p;
  const s = slot(eye), img = s.querySelector("img");
  img.hidden = !p; if (p) { img.src = p.dataUrl; img.alt = t("eye_" + eye); } else img.removeAttribute("src");
  s.querySelector(".ph").hidden = !!p; s.querySelector(".drop").classList.toggle("has", !!p);
  s.querySelector("[data-act=remove]").hidden = !p;
  renderQc(eye);
}
function renderQc(eye) {
  const ul = slot(eye).querySelector(".qc"); ul.replaceChildren();
  const p = state.photos[eye]; if (!p) return;
  for (const c of p.quality.checks) { const li = el("li", "qc-" + c.status, t(`qc_${c.id}_${c.status}`)); ul.append(li); }
  ul.append(el("li", "qc-sum " + (p.quality.retake ? "qc-warn" : "qc-ok"), t(p.quality.retake ? "qc_retake" : "qc_good")));
}
async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("read")); i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
async function processSource(src, w, h) {
  const { w: ow, h: oh } = scaleSize(w, h, OUT_MAX);
  const c = document.createElement("canvas"); c.width = ow; c.height = oh;
  c.getContext("2d").drawImage(src, 0, 0, ow, oh);
  const dataUrl = c.toDataURL("image/jpeg", 0.85);
  const k = Math.min(1, 256 / Math.max(ow, oh)), aw = Math.max(1, Math.round(ow * k)), ah = Math.max(1, Math.round(oh * k));
  const a = document.createElement("canvas"); a.width = aw; a.height = ah;
  const actx = a.getContext("2d", { willReadFrequently: true }); actx.drawImage(c, 0, 0, aw, ah);
  const rgba = actx.getImageData(0, 0, aw, ah);
  let face = "unavailable";
  if ("FaceDetector" in window) { try { const f = await new window.FaceDetector({ fastMode: true }).detect(c); face = f.length ? "found" : "none"; } catch { face = "unavailable"; } }
  return { dataUrl, quality: assess({ naturalWidth: w, naturalHeight: h, rgba: { width: aw, height: ah, data: rgba.data }, face }) };
}
async function handleFile(eye, file) {
  const s = slot(eye), msg = s.querySelector(".msg");
  const chk = checkFile(file);
  if (!chk.ok) { showMsg(msg, { format: "err_format", too_big: "err_too_big", empty: "err_empty", missing: "err_read" }[chk.code]); return; }
  try {
    const img = await loadImage(file);
    setPhoto(eye, await processSource(img, img.naturalWidth, img.naturalHeight)); showMsg(msg, "");
  } catch { showMsg(msg, "err_read"); }
}
let camEye = null, camStream = null;
document.querySelectorAll(".slot").forEach((s) => {
  const eye = s.dataset.eye, input = s.querySelector("input[type=file]");
  s.addEventListener("click", (ev) => {
    const act = ev.target.closest("button")?.dataset.act;
    if (act === "upload") input.click();
    if (act === "remove") { setPhoto(eye, null); showMsg(s.querySelector(".msg"), ""); }
    if (act === "camera") openCamera(eye);
  });
  input.addEventListener("change", async () => { const f = input.files[0]; if (f) await handleFile(eye, f); input.value = ""; });
});
async function openCamera(eye) {
  camEye = eye; $("camErr").hidden = true; $("camDlg").showModal();
  try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); $("camVideo").srcObject = camStream; }
  catch { showMsg($("camErr"), "cam_err"); }
}
function stopCam() { camStream?.getTracks().forEach((x) => x.stop()); camStream = null; $("camVideo").srcObject = null; }
$("camClose").addEventListener("click", () => { stopCam(); $("camDlg").close(); });
$("camDlg").addEventListener("close", stopCam);
$("camShot").addEventListener("click", async () => {
  const v = $("camVideo"); if (!v.videoWidth) return;
  const eye = camEye; const p = await processSource(v, v.videoWidth, v.videoHeight);
  setPhoto(eye, p); stopCam(); $("camDlg").close();
});
$("p1next").addEventListener("click", () => { state.q = 0; setStep(2); renderQuestion(); });

// ---------- urgent banner (deterministic rules, never AI) ----------
function currentTriage() { return runTriage(state.answers, state.answers.text); }
function showTriage(tr) {
  const box = $("urgent");
  if (!tr || (tr.level !== "emergency" && tr.level !== "urgent")) { box.hidden = true; return; }
  box.hidden = false; box.dataset.level = tr.level;
  $("urgentTitle").textContent = t("urg_" + tr.level + "_t");
  $("urgentBody").textContent = t("urg_" + tr.level + "_d");
  const ul = $("urgentWhy"); ul.replaceChildren();
  tr.reasons.filter((r) => r.level === "emergency" || r.level === "urgent").forEach((r) => ul.append(el("li", null, t("why_" + r.id))));
}

// ---------- symptom wizard ----------
const TOTAL = TOTAL_STEPS; // single source of truth: symptoms.js
function renderQuestion() {
  const i = state.q, isText = i >= QUESTIONS.length;
  $("qCount").textContent = t("q_of", { n: i + 1, total: TOTAL });
  $("qBar").style.width = ((i + 1) / TOTAL) * 100 + "%";
  $("qBack").disabled = false; $("qErr").hidden = true;
  const opts = $("qOpts"); opts.replaceChildren();
  $("qTextWrap").hidden = !isText; opts.hidden = isText;
  $("qNext").textContent = t(isText ? "btn_next" : "btn_next");
  if (isText) {
    $("qLegend").textContent = t("q_text_label");
    const ta = $("qText"); ta.value = state.answers.text || ""; updateCount();
    return;
  }
  const q = QUESTIONS[i]; $("qLegend").textContent = t("q_" + q.id);
  q.options.forEach((o, k) => {
    const id = `q_${q.id}_${o}`; const lab = el("label", "opt");
    const inp = el("input"); inp.type = q.type === "multi" ? "checkbox" : "radio"; inp.name = q.id; inp.value = o; inp.id = id;
    const cur = state.answers[q.id]; inp.checked = q.type === "multi" ? (cur || []).includes(o) : cur === o;
    inp.addEventListener("change", () => onAnswer(q, inp));
    lab.append(inp, el("span", null, t(`qo_${q.id}_${o}`))); opts.append(lab);
  });
  opts.querySelector("input")?.focus({ preventScroll: true });
}
function onAnswer(q, inp) {
  if (q.type === "multi") {
    let cur = new Set(state.answers.history || []);
    if (inp.checked) { if (inp.value === "none") cur = new Set(["none"]); else { cur.delete("none"); cur.add(inp.value); } } else cur.delete(inp.value);
    state.answers.history = [...cur];
    document.querySelectorAll("#qOpts input").forEach((x) => { x.checked = cur.has(x.value); });
  } else state.answers[q.id] = inp.value;
  $("qErr").hidden = true;
  state.triage = currentTriage(); showTriage(state.triage);
}
function updateCount() { $("qTextCount").textContent = $("qText").value.length + " / " + MAX_TEXT; }
$("qText").addEventListener("input", () => { state.answers.text = $("qText").value; updateCount(); state.triage = currentTriage(); showTriage(state.triage); });
$("qNext").addEventListener("click", () => {
  const i = state.q;
  if (i < QUESTIONS.length) {
    const q = QUESTIONS[i], v = state.answers[q.id];
    if (q.required && (v == null || v === "")) { showMsg($("qErr"), "q_required"); return; }
    if (q.id === "history" && !(v || []).length) { state.answers.history = ["none"]; }
  } else if ($("qText").value.length > MAX_TEXT) { showMsg($("qErr"), "q_too_long"); return; }
  if (i + 1 >= TOTAL) { renderReview(); setStep(3); return; }
  state.q = i + 1; renderQuestion();
});
$("qBack").addEventListener("click", () => { if (state.q === 0) { setStep(1); return; } state.q--; renderQuestion(); });

// ---------- review ----------
function labelFor(id, v) { return t(`qo_${id}_${v}`); }
function renderReview() {
  const a = state.answers, dl = $("reviewList"); dl.replaceChildren();
  state.answers.history = (a.history && a.history.length) ? a.history : ["none"];
  QUESTIONS.forEach((q, idx) => {
    const v = a[q.id];
    const dt = el("dt", null, t("q_" + q.id));
    const dd = el("dd"); dd.append(el("span", null, q.type === "multi" ? (v || []).map((x) => labelFor(q.id, x)).join(", ") : v ? labelFor(q.id, v) : "-"));
    const b = el("button", "btn btn-link", t("q_edit")); b.type = "button"; b.addEventListener("click", () => { state.q = idx; setStep(2); renderQuestion(); }); dd.append(b);
    dl.append(dt, dd);
  });
  if (a.text) { dl.append(el("dt", null, t("q_text_label"))); const dd = el("dd"); dd.append(el("span", null, sanitizeText(a.text))); const b = el("button", "btn btn-link", t("q_edit")); b.type = "button"; b.addEventListener("click", () => { state.q = QUESTIONS.length; setStep(2); renderQuestion(); }); dd.append(b); dl.append(dd); }
  const ph = $("reviewPhotos"); ph.replaceChildren();
  for (const e of ["right", "left"]) { const p = state.photos[e]; if (!p) continue; const f = el("figure"); const i = el("img"); i.src = p.dataUrl; i.alt = t("eye_" + e); f.append(i, el("figcaption", null, t("eye_" + e) + ": " + t("iq_" + p.quality.overall))); ph.append(f); }
  $("reviewNote").textContent = Object.values(state.photos).some(Boolean) ? "" : t("rep_no_photo");
  state.triage = currentTriage(); showTriage(state.triage);
}
$("p3back").addEventListener("click", () => { state.q = TOTAL - 1; setStep(2); renderQuestion(); });

// ---------- screening flow ----------
const STAGES = ["pr_prepare", "pr_model", "pr_analyze", "pr_validate"];
function renderProgress(active, extra) {
  const ol = $("progress"); ol.replaceChildren();
  STAGES.forEach((k, i) => { const li = el("li", i < active ? "done" : i === active ? "on" : "", t(k)); if (i === active && extra) li.append(el("small", null, " " + extra)); ol.append(li); });
}
function inputParts() {
  const summary = buildSummary(state.answers);
  const eyes = ["right", "left"].filter((e) => state.photos[e]);
  const quality = Object.fromEntries(eyes.map((e) => [e, state.photos[e].quality]));
  const parts = [buildPrompt({ summary, eyes, lang: getLang(), quality })];
  for (const e of eyes) { parts.push(e + " eye photo:"); parts.push({ inlineData: { mimeType: "image/jpeg", data: state.photos[e].dataUrl.split(",")[1] } }); }
  return { summary, eyes, quality, parts };
}
$("analyze").addEventListener("click", async () => {
  if (state.busy) return;
  const v = validate(state.answers);
  if (!v.ok && !Object.values(state.photos).some(Boolean)) { showMsg($("scanMsg"), "err_nothing"); return; }
  showMsg($("scanMsg"), "");
  state.busy = true; $("analyze").disabled = true;
  const input = inputParts(); state.input = input; state.triage = currentTriage(); showTriage(state.triage);
  setStep(4); $("cloudPreview").hidden = true; showMsg($("runMsg"), ""); $("p4back").hidden = true;
  renderProgress(0);
  document.querySelectorAll(".drop.has").forEach((d) => d.classList.add("scanning"));
  try {
    renderProgress(1);
    const res = await runScreening({ input, engines, onProgress: (p) => { renderProgress(1, t("dl_model", { pct: Math.round(p * 100) })); } });
    renderProgress(2); await finish(res);
  } catch (e) {
    if (e instanceof AiError && (e.code === "nano_unavailable" || e.code === "nano_failed")) offerCloud(e.code === "nano_unavailable" ? t("cloud_why_unavail") : t("cloud_why_failed", { err: e.message }));
    else handleAiError(e);
  } finally { state.busy = false; $("analyze").disabled = false; document.querySelectorAll(".drop.has").forEach((d) => d.classList.remove("scanning")); }
});
function handleAiError(e) {
  console.warn(e);
  const key = e instanceof AiError && e.code === "invalid_json" ? "err_invalid_json" : e instanceof AiError && e.code === "invalid_schema" ? "err_invalid_schema" : null;
  showMsg($("runMsg"), key || "err_generic", { err: e.message }); $("p4back").hidden = false;
}
async function finish({ source, model, raw }) {
  renderProgress(3);
  let report;
  try { report = validateReport(raw, { eyes: state.input.eyes, triageLevel: state.triage.level, appQuality: state.input.quality }); }
  catch (e) { handleAiError(e); return; }
  renderProgress(4);
  state.ctx = { at: new Date().toISOString(), summary: state.input.summary, report, triage: state.triage, source, model, thumbs: {} };
  for (const e of state.input.eyes) state.ctx.thumbs[e] = state.photos[e].dataUrl;
  let thumb = null; const first = state.input.eyes[0]; if (first) thumb = await makeThumb(state.photos[first].dataUrl);
  history.add({ at: state.ctx.at, summary: state.ctx.summary, report, triageIds: state.triage.reasons.map((r) => ({ id: r.id, level: r.level })), source, model, thumb });
  renderReport(); renderHistory(); for (let i = 1; i <= 4; i++) $("p" + i).hidden = true;
  document.querySelectorAll("#stepper li").forEach((li) => li.classList.add("done"));
  $("report").hidden = false; $("report").scrollIntoView({ behavior: "smooth", block: "start" });
}
function makeThumb(url) {
  return new Promise((r) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = 96; c.height = 72; c.getContext("2d").drawImage(i, 0, 0, 96, 72); r(c.toDataURL("image/jpeg", 0.6)); }; i.onerror = () => r(null); i.src = url; });
}

// ---------- cloud consent (never automatic) ----------
function logSend(what, model) { state.cloudLog.push({ at: new Date(), what, model }); renderLog(); }
function offerCloud(why) {
  const { summary, eyes } = state.input;
  $("cloudWhy").textContent = why;
  const th = $("cloudThumbs"); th.replaceChildren();
  for (const e of eyes) { const i = el("img"); i.src = state.photos[e].dataUrl; i.alt = t("eye_" + e); th.append(i); }
  $("cloudText").textContent = summaryToText(summary) + "\n\n" + t("cloud_photos") + ": " + (eyes.length ? eyes.map((e) => t("eye_" + e)).join(", ") : t("cloud_none")) + "\n" + t("cloud_instr");
  $("cloudAck").checked = false; $("cloudSend").disabled = true; $("cloudPreview").hidden = false; $("p4back").hidden = false;
  $("cloudAck").onchange = () => { $("cloudSend").disabled = !$("cloudAck").checked; };
  $("cloudCancel").onclick = () => { $("cloudPreview").hidden = true; showMsg($("runMsg"), "cancelled", null, true); };
  $("cloudSend").onclick = async () => {
    if (!$("cloudAck").checked) return;
    const consent = { granted: true, preview: true, at: Date.now() };
    $("cloudSend").disabled = true; showMsg($("runMsg"), "running_cloud", null, true); renderProgress(2);
    document.querySelectorAll(".drop.has").forEach((d) => d.classList.add("scanning"));
    try {
      logSend((eyes.length ? t("log_photos", { n: eyes.length }) + ", " : "") + t("log_answers"), "Gemini");
      const res = await runCloudWithConsent({ input: state.input, engines, consent });
      $("cloudPreview").hidden = true; showMsg($("runMsg"), ""); await finish(res);
    } catch (e) { if (e instanceof AiError) handleAiError(e); else showMsg($("runMsg"), "err_cloud", { err: e.message }); }
    finally { document.querySelectorAll(".drop.has").forEach((d) => d.classList.remove("scanning")); }
  };
}
$("p4back").addEventListener("click", () => { $("cloudPreview").hidden = true; setStep(3); });

// ---------- report ----------
const U_ICON = { routine: "✓", soon: "!", urgent: "!!", emergency: "⚠" };
function renderReport() {
  const c = state.ctx; if (!c) return;
  const r = c.report;
  const eb = $("engineBadge"); const demo = c.source === "demo";
  eb.className = "badge " + (demo ? "badge-demo" : c.source === "on_device" ? "badge-device" : "badge-cloud");
  $("demoBanner").hidden = !demo; $("explain").hidden = demo; $("docSum").hidden = demo; // demo: nothing may go to the cloud
eb.textContent = demo ? t("eng_badge_demo") : t(c.source === "on_device" ? "eng_badge_device" : "eng_badge_cloud") + (c.source === "on_device" ? "" : " · " + c.model);
  $("reportMeta").textContent = new Date(c.at).toLocaleString(getLang() === "ar" ? "ar-EG" : undefined);
  const o = $("overall"); o.className = "overall u-" + r.urgency; o.replaceChildren();
  const ic = el("div", "u-ic", U_ICON[r.urgency]); ic.setAttribute("aria-hidden", "true");
  const body = el("div"); body.append(el("h3", null, t("urg_" + r.urgency + "_t")), el("p", null, t("urg_" + r.urgency + "_d")));
  const why = c.triage.reasons.filter((x) => x.level !== "routine");
  if (why.length) { const ul = el("ul", "why"); why.forEach((x) => ul.append(el("li", null, t("why_" + x.id)))); body.append(el("small", null, t("rep_safety_why")), ul); }
  body.append(el("small", "muted", t("rep_urgency_src")));
  if (r.reassurance_blocked) body.append(el("p", "warnline", t("rep_reassure_blocked")));
  o.append(ic, body);
  // quality
  const qb = $("qualityBox"); qb.replaceChildren();
  const ai = el("p"); ai.append(el("b", null, t("iq_ai") + ": "), document.createTextNode(t("iq_" + r.image_quality.overall))); qb.append(ai);
  r.image_quality.issues.forEach((x) => qb.append(el("p", "small", x)));
  for (const e of Object.keys(c.thumbs)) { /* app-side quality was stored with the photos only in this run */ }
  if (state.input && c === state.ctx && state.input.quality) for (const [e, q] of Object.entries(state.input.quality)) qb.append(el("p", "small", t("iq_app") + " (" + t("eye_" + e) + "): " + t("iq_" + q.overall)));
  // symptoms
  const sb = $("symBox"); sb.replaceChildren();
  if (r.symptom_summary) sb.append(el("p", null, r.symptom_summary));
  const ul = el("ul", "kv"); const s = c.summary;
  [["eye", labelFor("eye", s.eye)], ["onset", labelFor("onset", s.onset)], ["pain", labelFor("pain", s.pain)], ["redness", labelFor("redness", s.redness)], ["blur", labelFor("blur", s.blur)], ["light", labelFor("light", s.light)], ["flashes", labelFor("flashes", s.flashes)], ["suddenLoss", labelFor("suddenLoss", s.suddenLoss)], ["injury", labelFor("injury", s.injury)], ["history", (s.history || []).map((h) => labelFor("history", h)).join(", ")], ["diabetes", labelFor("diabetes", s.diabetes)]]
    .forEach(([k, v]) => { const li = el("li"); li.append(el("span", "k", t("q_" + k)), el("b", null, v)); ul.append(li); });
  sb.append(ul); if (s.text) sb.append(el("p", "small", t("q_text_label") + ": " + s.text));
  // eyes
  const cmp = $("eyesCmp"); cmp.replaceChildren();
  for (const e of ["right", "left"]) {
    const b = el("div", "eyebox"); b.append(el("h5", null, t("eye_" + e)));
    const img = c.thumbs[e] || c.thumbStored; if (c.thumbs[e]) { const i = el("img"); i.src = c.thumbs[e]; i.alt = t("eye_" + e); b.append(i); }
    if (r.observations[e]) {
      b.append(el("span", "tag", t("ai_obs")));
      const ul2 = el("ul"); (r.observations[e].length ? r.observations[e] : [t("rep_no_obs")]).forEach((x) => ul2.append(el("li", null, x))); b.append(ul2);
    } else b.append(el("p", "muted small", t(c.thumbs[e] ? "rep_photo_unassessed" : "rep_no_photo")));
    cmp.append(b);
  }
  // assessability: fixed by the app
  const tb = $("assessTbl").querySelector("tbody"); tb.replaceChildren();
  for (const k of [...NOT_ASSESSABLE, "cataract"]) { const tr = el("tr"); tr.append(el("td", null, t("na_" + k)), el("td", k === "cataract" ? "st-lim" : "st-na", t(k === "cataract" ? "na_cataract_status" : "na_status"))); tb.append(tr); }
  const st = $("steps"); st.replaceChildren(el("h4", null, t("rep_steps"))); const u1 = el("ul"); r.next_steps.forEach((x) => u1.append(el("li", null, x)));
  if (!r.next_steps.length) u1.append(el("li", null, t("urg_" + r.urgency + "_d"))); st.append(u1);
  const lm = $("limits"); lm.replaceChildren(el("h4", null, t("rep_limits"))); const u2 = el("ul"); r.limitations.forEach((x) => u2.append(el("li", null, x))); if (r.uncertainty) u2.append(el("li", null, r.uncertainty)); lm.append(u2);
  if (r.missing.length) lm.append(el("p", "muted small", t("rep_missing", { list: r.missing.join(", ") })));
  $("docOut").hidden = true; $("explainOut").hidden = true;
}
$("print").addEventListener("click", () => window.print());
$("again").addEventListener("click", () => resetFlow());
$("docSum").addEventListener("click", () => {
  const c = state.ctx; if (!c) return;
  const box = $("docOut"); box.hidden = !box.hidden; if (box.hidden) return;
  box.textContent = doctorSummary({ t, when: new Date(c.at).toLocaleString(), summary: c.summary, report: c.report, triage: c.triage, source: c.source, model: c.model, label: labelFor });
  box.dir = getLang() === "ar" ? "rtl" : "ltr";
  navigator.clipboard?.writeText(box.textContent).then(() => { $("docSum").textContent = t("copied"); setTimeout(() => ($("docSum").textContent = t("btn_doc")), 1500); }).catch(() => {});
});
$("explain").addEventListener("click", async () => {
  const c = state.ctx; if (!c) return;
  if (!confirm(t("expl_confirm"))) return;
  const out = $("explainOut"); out.hidden = false; out.className = "out loading"; out.textContent = t("expl_asking");
  try {
    const sum = [c.report.symptom_summary, c.report.urgency, c.report.limitations.join(" ")].filter(Boolean).join(" | ");
    logSend(t("log_text_only"), "Gemini");
    const res = await engines.runCloudText(t("expl_prompt") + "\n\n" + sum);
    out.className = "out"; out.textContent = res.text;
  } catch (e) { out.className = "out err"; out.textContent = t("err_cloud", { err: e.message }); }
});
function resetFlow() {
  state.photos = { left: null, right: null }; state.answers = { history: [], text: "" }; state.q = 0; state.triage = null; state.ctx = null;
  setPhoto("left", null); setPhoto("right", null); $("report").hidden = true; showTriage(null); setStep(1);
}

// ---------- history / timeline ----------
function renderHistory() {
  const h = history.list(), list = $("histList"); list.replaceChildren();
  $("clearHist").hidden = !h.length; $("histMode").textContent = t(history.isPersistent() ? "hist_mode_dev" : "hist_mode_tab");
  $("persistToggle").checked = history.isPersistent();
  $("cmpBox").hidden = true;
  if (!h.length) { list.append(el("li", "muted", t("hist_empty"))); return; }
  h.forEach((e, idx) => {
    const li = el("li", "tl u-" + e.report.urgency);
    li.append(el("span", "dot"));
    if (e.thumb) { const i = el("img"); i.src = e.thumb; i.alt = ""; li.append(i); }
    const tx = el("div", "t"); tx.append(el("b", null, new Date(e.at).toLocaleString(getLang() === "ar" ? "ar-EG" : undefined)), el("small", null, t("urg_" + e.report.urgency) + " · " + t(e.source === "on_device" ? "eng_device" : "eng_cloud")), el("small", "muted", e.report.symptom_summary || ""));
    const acts = el("div", "acts");
    const open = el("button", "btn btn-ghost", t("hist_open")); open.type = "button";
    open.addEventListener("click", () => { state.ctx = { at: e.at, summary: e.summary, report: e.report, triage: { level: e.report.urgency, reasons: e.triageIds || [] }, source: e.source, model: e.model, thumbs: {} }; state.input = null; renderReport(); $("report").hidden = false; $("report").scrollIntoView({ behavior: "smooth" }); });
    acts.append(open);
    if (h[idx + 1]) { const cb = el("button", "btn btn-ghost", t("hist_compare")); cb.type = "button"; cb.setAttribute("aria-label", t("hist_compare_with")); cb.addEventListener("click", () => showCompare(e, h[idx + 1])); acts.append(cb); }
    const del = el("button", "btn btn-link", t("hist_delete")); del.type = "button"; del.addEventListener("click", () => { history.remove(e.id); renderHistory(); renderPrivacy(); });
    acts.append(del); li.append(tx, acts); list.append(li);
  });
}
function cmpVal(key, v) {
  if (v == null) return "-";
  if (key === "urgency") return t("urg_" + v); if (key === "quality") return t("iq_" + v);
  if (Array.isArray(v)) return v.map((x) => labelFor(key, x)).join(", ");
  return labelFor(key, v);
}
function showCompare(a, b) {
  const box = $("cmpBox"); box.hidden = false; box.replaceChildren(el("h4", null, t("cmp_h")));
  const tbl = el("table", "tbl"); const th = el("thead"); const hr = el("tr");
  ["cmp_item", "cmp_a", "cmp_b", "cmp_diff"].forEach((k) => { const c = el("th", null, k === "cmp_diff" ? "" : t(k)); c.scope = "col"; hr.append(c); }); th.append(hr); tbl.append(th);
  const tbd = el("tbody");
  for (const r of compare(a, b)) { const tr = el("tr", r.same ? "" : "diff"); const lab = r.key === "urgency" ? t("cmp_urgency") : r.key === "quality" ? t("cmp_quality") : t("q_" + r.key); tr.append(el("td", null, lab), el("td", null, cmpVal(r.key, r.a)), el("td", null, cmpVal(r.key, r.b)), el("td", null, r.same ? t("cmp_same") : t("cmp_diff"))); tbd.append(tr); }
  tbl.append(tbd); box.append(tbl, el("p", "muted small", t("hist_note")));
  const x = el("button", "btn btn-link", t("cmp_close")); x.type = "button"; x.addEventListener("click", () => (box.hidden = true)); box.append(x);
  box.scrollIntoView({ block: "nearest" });
}
$("clearHist").addEventListener("click", () => { history.clear(); renderHistory(); renderPrivacy(); });
$("persistToggle").addEventListener("change", (e) => { history.setPersistent(e.target.checked); renderHistory(); renderPrivacy(); });

// ---------- privacy center ----------
function renderPrivacy() { $("privStore").textContent = t(history.isPersistent() ? "priv_store_dev" : "priv_store_tab"); renderLog(); }
function renderLog() {
  const ol = $("sendLog"); ol.replaceChildren();
  if (!state.cloudLog.length) { ol.append(el("li", "muted", t("log_none"))); return; }
  state.cloudLog.forEach((e) => ol.append(el("li", null, t("log_at", { time: e.at.toLocaleTimeString(), what: e.what, model: e.model }))));
}
$("delAll").addEventListener("click", () => {
  history.clear(); localStorage.removeItem("eyecheck.persist.consent"); localStorage.removeItem("theme"); localStorage.removeItem("lang"); sessionStorage.clear();
  renderHistory(); renderPrivacy(); $("delMsg").textContent = t("priv_deleted");
});

// ---------- demo mode (synthetic, no AI, never saved to history) ----------
function startDemo(id) {
  state.ctx = demoContext(id, t, runTriage); state.input = null;
  renderReport(); $("report").hidden = false; $("report").scrollIntoView({ behavior: "smooth", block: "start" });
}
document.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => startDemo(b.dataset.demo)));
$("demoExit").addEventListener("click", () => {
  if (state.ctx && state.ctx.demo) state.ctx = null;
  $("report").hidden = true; $("demo").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- reminder (local only) ----------
let remindTimer = null;
$("remind").addEventListener("click", async () => {
  const msg = $("remindMsg"); msg.hidden = false;
  if (remindTimer) { clearInterval(remindTimer); remindTimer = null; msg.textContent = t("remind_off"); return; }
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
  remindTimer = setInterval(() => { const m = t("remind_text"); if ("Notification" in window && Notification.permission === "granted") new Notification("EyeCheck", { body: m }); else alert(m); }, 20 * 60 * 1000);
  msg.textContent = t("remind_on");
});

function renderAll() {
  renderNano(); if (state.step === 2) renderQuestion(); if (state.step === 3) renderReview();
  for (const e of ["right", "left"]) { renderQc(e); const p = state.photos[e]; if (p) slot(e).querySelector("img").alt = t("eye_" + e); }
  if (state.triage) showTriage(state.triage);
  if (state.ctx && state.ctx.demo) state.ctx = demoContext(state.ctx.demo, t, runTriage); // re-render in the new language
  if (state.ctx && !$("report").hidden) renderReport();
  renderHistory(); renderPrivacy(); renderProgress(state.step === 4 ? 2 : 0);
}
applyLang(localStorage.getItem("lang") || "en");
setStep(1, false);
history.purgeExpired();
document.addEventListener("visibilitychange", () => { if (!document.hidden) { history.purgeExpired(); renderHistory(); } });
checkNano();
