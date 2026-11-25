import "./style.css";
import { deviceOnlyModel, cloudModel, cloudModelLite } from "./firebase.js";
async function cloudGen(input) {
  try { return await cloudModel.generateContent(input); }
  catch (e) { console.warn("Primary cloud model failed, trying lite:", e); return await cloudModelLite.generateContent(input); }
}

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const RED_FLAGS = /(sudden|suddenly).*(vision loss|blind|can't see|cannot see)|loss of vision|severe (eye )?pain|flashes|curtain|chemical|trauma|injur|floaters/i;
const CONDITIONS = ["Cataract", "Glaucoma", "Diabetic retinopathy", "Age-related macular degeneration"];
let lang = localStorage.getItem("lang") || "en";
const photos = { left: null, right: null }; // data URLs, kept in memory only
let lastReport = null;

// ---------- theme ----------
const root = document.documentElement;
const prefersDark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
root.dataset.theme = localStorage.getItem("theme") || (prefersDark ? "dark" : "light");
$("theme").addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", root.dataset.theme);
});

// ---------- on-device availability ----------
let nanoState = "unknown";
async function checkNano() {
  const badge = $("engineStatus");
  try {
    if (typeof LanguageModel === "undefined") throw new Error("no api");
    const a = await LanguageModel.availability({ expectedInputs: [{ type: "text" }, { type: "image" }] });
    nanoState = a;
  } catch { nanoState = "unavailable"; }
  const ok = nanoState !== "unavailable";
  badge.className = "badge " + (ok ? "badge-device" : "badge-fallback");
  badge.textContent = ok ? "On-device AI ready (Gemini Nano)" : "On-device AI not available here";
}
checkNano();

// ---------- photos ----------
function downscale(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1024, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read this image")); };
    img.src = url;
  });
}
function setPhoto(eye, dataUrl) {
  photos[eye] = dataUrl;
  const slot = document.querySelector(`.slot[data-eye=${eye}]`);
  const img = slot.querySelector("img"), drop = slot.querySelector(".drop");
  img.hidden = !dataUrl; if (dataUrl) img.src = dataUrl; else img.removeAttribute("src");
  slot.querySelector(".ph").hidden = !!dataUrl;
  drop.classList.toggle("has", !!dataUrl);
  slot.querySelector('[data-act=remove]').hidden = !dataUrl;
}
let camEye = null, camStream = null;
document.querySelectorAll(".slot").forEach((slot) => {
  const eye = slot.dataset.eye, input = slot.querySelector("input[type=file]");
  slot.addEventListener("click", async (ev) => {
    const act = ev.target.closest("button")?.dataset.act;
    if (act === "upload") input.click();
    if (act === "remove") setPhoto(eye, null);
    if (act === "camera") openCamera(eye);
  });
  input.addEventListener("change", async () => {
    if (!input.files[0]) return;
    try { setPhoto(eye, await downscale(input.files[0])); } catch (e) { showMsg(e.message); }
    input.value = "";
  });
});
async function openCamera(eye) {
  camEye = eye; $("camErr").hidden = true;
  $("camDlg").showModal();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    $("camVideo").srcObject = camStream;
  } catch {
    $("camErr").textContent = "Camera not available or permission denied. Use Upload instead.";
    $("camErr").hidden = false;
  }
}
function closeCamera() {
  camStream?.getTracks().forEach((t) => t.stop()); camStream = null;
  $("camVideo").srcObject = null; if ($("camDlg").open) $("camDlg").close();
}
$("camClose").addEventListener("click", closeCamera);
$("camDlg").addEventListener("close", () => { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; });
$("camShot").addEventListener("click", () => {
  const v = $("camVideo"); if (!v.videoWidth) return;
  const k = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas"); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  setPhoto(camEye, c.toDataURL("image/jpeg", 0.85)); closeCamera();
});

// ---------- messages ----------
function showMsg(t, info) { const m = $("scanMsg"); m.textContent = t; m.className = "msg" + (info ? " info" : ""); m.hidden = !t; }

// ---------- AI ----------
function buildPrompt(symptoms, eyes) {
  return [
    "You are an AI assistant giving PRELIMINARY, non-diagnostic eye screening information. You are not a doctor.",
    "Look at the provided eye photo(s) (labelled left/right) and the optional symptom text.",
    "Never state a diagnosis. Use cautious wording like 'possible signs'. Do not claim accuracy.",
    "External photos cannot show the retina: for diabetic retinopathy, glaucoma and macular degeneration use level \"not_assessable\" unless the symptoms text clearly suggests a concern, in which case use \"possible\".",
    "If an image is not an eye or is too poor, say so in image_quality.",
    "Reply with ONLY compact JSON, no markdown, in this shape:",
    '{"urgency":"routine|soon|urgent","image_quality":"good|fair|poor|not_an_eye|no_image","summary":"1-2 sentences",',
    '"screening":[{"condition":"Cataract","level":"low|possible|elevated|not_assessable","note":"short"},{"condition":"Glaucoma",...},{"condition":"Diabetic retinopathy",...},{"condition":"Age-related macular degeneration",...}],',
    '"eyes":{"left":{"observations":["..."],"areas_of_interest":["..."]},"right":{"observations":["..."],"areas_of_interest":["..."]}},',
    '"next_steps":["..."]}',
    "Include only eyes that were provided. Keep each string under 140 characters.",
    (lang === "ar" ? "Write all string values in Arabic (Modern Standard, simple). Keep the JSON keys and the level/urgency/image_quality enum values in English." : "Write in English."),
    "Symptoms: " + (symptoms || "none given") + ".",
    "Photos provided: " + (eyes.length ? eyes.join(", ") : "none") + ".",
  ].join("\n");
}
function parts(symptoms) {
  const eyes = Object.keys(photos).filter((k) => photos[k]);
  const p = [buildPrompt(symptoms, eyes)];
  for (const e of eyes) {
    p.push(e + " eye photo:");
    p.push({ inlineData: { mimeType: "image/jpeg", data: photos[e].split(",")[1] } });
  }
  return p;
}
function parseJson(t) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("The model did not return a readable result. Please try again.");
  return JSON.parse(t.slice(s, e + 1));
}
async function runOnDevice(symptoms) {
  await deviceOnlyModel.initializeDeviceModel?.((p) => showMsg("Downloading on-device model: " + Math.round(p * 100) + "%", true));
  const r = await deviceOnlyModel.generateContent(parts(symptoms));
  return { data: parseJson(r.response.text()), source: "on_device" };
}
async function runCloud(symptoms) {
  const r = await cloudGen(parts(symptoms));
  return { data: parseJson(r.response.text()), source: "in_cloud" };
}

// ---------- flow ----------
function setBusy(b) { $("analyze").disabled = b; }
function showUrgent(on, why) {
  $("urgent").hidden = !on;
  if (on) { if (why) $("urgentWhy").textContent = why; $("urgent").classList.remove("reveal"); void $("urgent").offsetWidth; $("urgent").classList.add("reveal"); }
}
function hasInput() { return photos.left || photos.right || $("symptoms").value.trim(); }

$("analyze").addEventListener("click", async () => {
  const symptoms = $("symptoms").value.trim();
  if (!hasInput()) { showMsg("Add at least one eye photo or describe your symptoms."); return; }
  $("cloudPreview").hidden = true; showMsg("");
  showUrgent(RED_FLAGS.test(symptoms));
  setBusy(true);
  setScan(true);
  try {
    if (nanoState === "unavailable") { offerCloud("Gemini Nano is not available in this browser, so nothing was analyzed. Nothing has been sent anywhere."); return; }
    showMsg("Analyzing on your device...", true);
    const res = await runOnDevice(symptoms);
    showMsg(""); render(res, symptoms);
  } catch (e) {
    console.warn(e);
    offerCloud("On-device analysis failed (" + (e.message || "error") + "). Nothing was sent anywhere.");
  } finally { setBusy(false); setScan(false); }
});
function setScan(on) { document.querySelectorAll(".drop.has").forEach((d) => d.classList.toggle("scanning", on)); }

function offerCloud(why) {
  showMsg("");
  const symptoms = $("symptoms").value.trim();
  $("cloudWhy").textContent = why + " You can optionally send the following to cloud Gemini through Firebase AI Logic. Nothing else is sent.";
  const th = $("cloudThumbs"); th.replaceChildren();
  for (const e of ["left", "right"]) if (photos[e]) { const i = el("img"); i.src = photos[e]; i.alt = e + " eye"; th.append(i); }
  $("cloudText").textContent = "Symptom text: " + (symptoms || "(none)") + "\nPhotos: " + (Object.keys(photos).filter((k) => photos[k]).join(", ") || "none");
  $("cloudPreview").hidden = false;
  $("cloudSend").onclick = async () => {
    $("cloudSend").disabled = true; showMsg("Sending to cloud Gemini...", true); setScan(true);
    try { const res = await runCloud(symptoms); $("cloudPreview").hidden = true; showMsg(""); render(res, symptoms); }
    catch (e) { showMsg("Cloud request failed: " + e.message); }
    finally { $("cloudSend").disabled = false; setScan(false); }
  };
  $("cloudCancel").onclick = () => { $("cloudPreview").hidden = true; showMsg("Cancelled. Nothing was sent.", true); };
}

// ---------- render ----------
function gauge(u) {
  const pct = u === "urgent" ? 100 : u === "soon" ? 62 : 28, col = u === "urgent" ? "#c62828" : u === "soon" ? "#f57f17" : "#2e7d32";
  const w = el("div", "gauge");
  w.innerHTML = '<svg viewBox="0 0 80 80"><circle class="g0" cx="40" cy="40" r="34"/><circle class="g1" cx="40" cy="40" r="34"/></svg>';
  const g1 = w.querySelector(".g1"); g1.style.stroke = col;
  requestAnimationFrame(() => requestAnimationFrame(() => (g1.style.strokeDashoffset = 213.6 * (1 - pct / 100))));
  w.append(el("b", null, u === "urgent" ? "!!" : u === "soon" ? "!" : "✓"));
  return w;
}
const LV = { low: ["Low signs", "lvl-low", 18, "#2e7d32"], possible: ["Possible signs", "lvl-possible", 55, "#f57f17"], elevated: ["Elevated signs", "lvl-elevated", 85, "#c62828"], not_assessable: ["Not assessable from photo", "lvl-na", 0, "#90a4ae"] };
const UR = { routine: ["u-routine", "✓", "Routine follow-up", "Nothing urgent stood out. Consider a routine eye exam."], soon: ["u-soon", "!", "See an eye doctor soon", "Some signs are worth checking. Book an appointment in the coming days."], urgent: ["u-urgent", "!!", "Seek care promptly", "Some signs may need prompt attention. Please see a doctor today."] };

function render({ data, source }, symptoms, fromHistory) {
  lastReport = { data, source, symptoms, at: new Date().toISOString(), thumbs: {} };
  const d = data;
  const ur = UR[d.urgency] || UR.routine;
  if (!fromHistory && d.urgency === "urgent") showUrgent(true, "The screening flagged signs that may need prompt attention.");
  const eb = $("engineBadge");
  eb.className = "badge " + (source === "on_device" ? "badge-device" : "badge-cloud");
  eb.textContent = source === "on_device" ? "Analyzed on-device (Gemini Nano)" : "Analyzed in cloud (Gemini)";
  $("reportMeta").textContent = new Date().toLocaleString() + " · Photo quality: " + (d.image_quality || "unknown").replace(/_/g, " ");
  const o = $("overall"); o.className = "overall " + ur[0]; o.replaceChildren(gauge(d.urgency), (() => { const w = el("div"); w.append(el("h3", null, ur[2]), el("p", null, d.summary || ur[3])); return w; })());
  const cards = $("cards"); cards.replaceChildren();
  const list = Array.isArray(d.screening) ? d.screening : [];
  CONDITIONS.forEach((name, i) => {
    const s = list.find((x) => x && String(x.condition).toLowerCase().startsWith(name.toLowerCase().slice(0, 6))) || list[i] || {};
    const lv = LV[s.level] || LV.not_assessable;
    const c = el("div", "cond"); c.style.animationDelay = i * 80 + "ms";
    const h = el("div", "cond-h"); h.append(el("b", null, name), el("span", "lvl " + lv[1], lv[0]));
    const bar = el("div", "bar"); const f = el("i"); f.style.background = lv[3]; f.style.width = "0%"; bar.append(f);
    requestAnimationFrame(() => requestAnimationFrame(() => (f.style.width = lv[2] + "%")));
    c.append(h, bar, el("p", null, s.note || "No details returned."));
    cards.append(c);
  });
  const cmp = $("eyesCmp"); cmp.replaceChildren();
  for (const e of ["left", "right"]) {
    const info = d.eyes && d.eyes[e]; if (!info && !photos[e]) continue;
    const b = el("div", "eyebox"); b.append(el("h4", null, e[0].toUpperCase() + e.slice(1) + " eye"));
    if (photos[e]) { const i = el("img"); i.src = photos[e]; i.alt = e + " eye"; b.append(i); lastReport.thumbs[e] = photos[e]; }
    const ul = el("ul");
    [...(info?.observations || []), ...(info?.areas_of_interest || []).map((x) => "Area of interest: " + x)].forEach((t) => ul.append(el("li", null, String(t))));
    if (!ul.children.length) ul.append(el("li", null, "No observations returned."));
    b.append(ul); cmp.append(b);
  }
  const st = $("steps"); st.replaceChildren(el("h4", null, "Suggested next steps"));
  const ul = el("ul"); (d.next_steps?.length ? d.next_steps : [ur[3]]).forEach((t) => ul.append(el("li", null, String(t)))); st.append(ul);
  $("explainOut").hidden = true;
  $("report").hidden = false; $("report").classList.remove("reveal"); void $("report").offsetWidth; $("report").classList.add("reveal");
  if (!fromHistory) addHistory();
  $("report").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- history (sessionStorage, thumbnails only) ----------
function loadHist() { try { return JSON.parse(sessionStorage.getItem("hist") || "[]"); } catch { return []; } }
function thumb(url) {
  return new Promise((r) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = 112; c.height = 84; c.getContext("2d").drawImage(i, 0, 0, 112, 84); r(c.toDataURL("image/jpeg", 0.6)); }; i.onerror = () => r(null); i.src = url; });
}
async function addHistory() {
  const r = lastReport; const t = photos.left || photos.right;
  const entry = { at: r.at, source: r.source, data: r.data, symptoms: r.symptoms, thumb: t ? await thumb(t) : null };
  const h = loadHist(); h.unshift(entry);
  try { sessionStorage.setItem("hist", JSON.stringify(h.slice(0, 10))); } catch {}
  renderHist();
}
function renderHist() {
  const h = loadHist(), list = $("histList"); list.replaceChildren();
  $("clearHist").hidden = !h.length;
  if (!h.length) { list.append(el("p", "muted", "No scans yet.")); return; }
  h.forEach((e, idx) => {
    const row = el("div", "hi");
    if (e.thumb) { const i = el("img"); i.src = e.thumb; i.alt = ""; row.append(i); } else row.append(el("img"));
    const t = el("div", "t"); t.append(el("b", null, new Date(e.at).toLocaleString()), el("small", null, (UR[e.data.urgency] || UR.routine)[2] + " · " + (e.source === "on_device" ? "On-device" : "Cloud")));
    const open = el("button", "btn btn-ghost", "Open"); open.type = "button";
    open.onclick = () => { render({ data: e.data, source: e.source }, e.symptoms, true); };
    const del = el("button", "btn btn-link", "Delete"); del.type = "button";
    del.onclick = () => { const x = loadHist(); x.splice(idx, 1); sessionStorage.setItem("hist", JSON.stringify(x)); renderHist(); };
    row.append(t, open, del); list.append(row);
  });
}
$("clearHist").addEventListener("click", () => { sessionStorage.removeItem("hist"); renderHist(); });
renderHist();

// ---------- print + cloud text-only explanation ----------
$("print").addEventListener("click", () => window.print());
$("explain").addEventListener("click", async () => {
  if (!lastReport) return;
  const out = $("explainOut"); out.hidden = false; out.className = "out loading";
  if (!confirm("Send only the text summary of this report (no photos, no symptom text) to cloud Gemini?")) { out.hidden = true; return; }
  out.textContent = "Asking cloud Gemini";
  try {
    const sum = (lastReport.data.summary || "") + " " + (lastReport.data.screening || []).map((s) => s.condition + ": " + s.level).join("; ");
    const r = await cloudGen("Explain this preliminary eye screening result in plain, calm language for a patient. No diagnosis. Say when to see an eye doctor and end with a reminder to see a professional.\n\n" + sum);
    out.className = "out"; out.textContent = r.response.text();
  } catch (e) { out.className = "out err"; out.textContent = "Cloud request failed: " + e.message; }
});

// ---------- reminders (local only, no AI) ----------
let remindTimer = null;
$("remind").addEventListener("click", async () => {
  const msg = $("remindMsg"); msg.hidden = false;
  if (remindTimer) { clearInterval(remindTimer); remindTimer = null; msg.textContent = lang === "ar" ? "تم إيقاف التذكير." : "Reminder stopped."; return; }
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
  remindTimer = setInterval(() => {
    const t = lang === "ar" ? "استراحة للعين: انظر لشيء بعيد 20 ثانية" : "Eye break: look at something 20 feet away for 20 seconds";
    if ("Notification" in window && Notification.permission === "granted") new Notification("EyeCheck", { body: t }); else alert(t);
  }, 20 * 60 * 1000);
  msg.textContent = lang === "ar" ? "التذكير يعمل طالما هذه الصفحة مفتوحة. اضغط مرة أخرى للإيقاف." : "Reminder runs while this page stays open. Click again to stop.";
});

// ---------- Arabic / English ----------
const AR = {
  "nav-scan": ["a[href='#scan']", "فحص"], "nav-hist": ["a[href='#history']", "السجل"], "nav-about": ["a[href='#about']", "حول"],
  eyebrow: [".eyebrow", "فحص أولي للعين بمساعدة الذكاء الاصطناعي"],
  lead: [".hero .lead", "أضف صور العين ووصف الأعراض. يحللها Gemini Nano على جهازك. لا يُستخدم Gemini السحابي إلا بموافقتك الصريحة."],
  s1: [".step:nth-of-type(1) b", "أضف الصور"], s2: [".flow .step:nth-child(3) b", "فحص على الجهاز"], s3: [".flow .step:nth-child(5) b", "التقرير"],
  notice: [".notice p", "فحص أولي وليس تشخيصاً طبياً. قد يخطئ الذكاء الاصطناعي، ولا تغني صورة الهاتف عن فحص العين. النتائج مجرد علامات محتملة. راجع طبيب عيون عند أي قلق."],
  h1s: ["#scan .card-h h2", "١. صور العين"], left: [".slot[data-eye=left] .slot-h", "العين اليسرى"], right: [".slot[data-eye=right] .slot-h", "العين اليمنى"],
  sym: ["#scan h2.sec:nth-of-type(1)", null], ph: ["#symptoms", null],
  analyze: ["#analyze span", "ابدأ الفحص"], priv: ["#privacyNote", "يعمل الفحص على جهازك بواسطة Gemini Nano. إن لم يدعمه متصفحك فلن يُرسل شيء. سترى بالضبط ما سيُرسل إلى Gemini السحابي ويمكنك الإرسال أو الإلغاء."],
  rep: ["#report .card-h h2", "تقرير الفحص"], print: ["#print", "طباعة / حفظ PDF"], explain: ["#explain", "شرح مبسط (سحابي، نص فقط)"],
  disc: [".disc", "فحص أولي بمساعدة الذكاء الاصطناعي فقط. ليس تشخيصاً طبياً ولم يتم التحقق منه سريرياً. راجع طبيب عيون عند أي قلق. في الطوارئ اتصل بالإسعاف."],
  hist: ["#history .card-h h2", "سجل الجلسة"], clear: ["#clearHist", "مسح الكل"],
  tipsT: ["[data-i=tipsT]", "نصائح للعناية بالعين"], docT: ["[data-i=docT]", "اختيار الطبيب المناسب"],
  tip1: ["[data-i=tip1]", "قاعدة 20-20-20: كل 20 دقيقة انظر لشيء على بعد 6 أمتار لمدة 20 ثانية."], tip2: ["[data-i=tip2]", "رمش كثيراً وضع الشاشة أسفل مستوى العين قليلاً."],
  tip3: ["[data-i=tip3]", "ارتدِ نظارة شمسية واقية من الأشعة فوق البنفسجية."], tip4: ["[data-i=tip4]", "لا تفرك عينيك. اغسل يديك قبل لمسهما أو لمس العدسات."],
  tip5: ["[data-i=tip5]", "افحص عينيك بانتظام، وسنوياً إن كنت مصاباً بالسكري."], remindB: ["[data-i=remindB]", "ذكّرني كل 20 دقيقة"],
  doc1: ["[data-i=doc1]", "أخصائي البصريات: فحص النظر والنظارات والفحص الروتيني."], doc2: ["[data-i=doc2]", "طبيب العيون: أمراض العين والجراحة والحالات العاجلة."],
  doc3: ["[data-i=doc3]", "أحضر قائمة الأعراض والأدوية وأي تقارير سابقة."], doc4: ["[data-i=doc4]", "تغير مفاجئ في الرؤية أو ألم شديد أو إصابة: اذهب إلى الطوارئ."],
  doc5: ["[data-i=doc5]", "ابحث في دليل الأطباء المحلي أو اسأل شركة التأمين."],
};
const EN = {};
function applyLang() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $("lang").textContent = lang === "ar" ? "EN" : "عربي";
  for (const [k, [sel, ar]] of Object.entries(AR)) {
    const e = document.querySelector(sel); if (!e || ar == null) continue;
    if (!(k in EN)) EN[k] = e.textContent;
    e.textContent = lang === "ar" ? ar : EN[k];
  }
  const ta = $("symptoms");
  if (!("ph" in EN)) EN.ph = ta.placeholder;
  ta.placeholder = lang === "ar" ? "مثال: العين اليمنى حمراء وبها حكة منذ 3 أيام بدون ألم" : EN.ph;
}
$("lang").addEventListener("click", () => { lang = lang === "ar" ? "en" : "ar"; localStorage.setItem("lang", lang); applyLang(); });
if (lang === "ar") applyLang();
