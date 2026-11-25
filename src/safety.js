// Deterministic red-flag triage. No AI is involved here, and the AI can never lower the result.
// IMPORTANT: these rules are conservative and based on commonly published ophthalmic
// warning signs. They have NOT been clinically reviewed or validated.
export const LEVELS = ["routine", "soon", "urgent", "emergency"];
export const rank = (l) => Math.max(0, LEVELS.indexOf(l));
export const maxLevel = (a, b) => (rank(a) >= rank(b) ? a : b);

// Free-text patterns (English + Arabic). A match inside a negation window is ignored.
const NEG = /(?:^|[^\p{L}])(?:no|not|without|never|denies|none|لا|بدون|مفيش|ليس|ليست|مافيش)(?![\p{L}])[^.\n,;]{0,18}$/iu;
const TEXT_RULES = [
  { id: "t_sudden_loss", level: "emergency", re: /(sudden(ly)?[^.\n]{0,25}(vision loss|lost (my )?vision|can'?t see|cannot see|blind|went blind)|loss of vision|lost (my )?(eye)?sight|فقدان (مفاجئ )?(ل)?(الرؤية|البصر)|فقدت (البصر|النظر)|مش شايف|مبقتش شايف|عمى مفاجئ)/i },
  { id: "t_curtain", level: "emergency", re: /(curtain|veil|shadow (over|across|in)|dark (area|spot|shade)|ستارة|ستار|ظل أسود|ضلمة في)/i },
  { id: "t_chemical", level: "emergency", re: /(chemical|bleach|acid|alkali|cleaning (product|fluid)|pepper spray|مواد كيميائية|كيماوي|كيماويات|كلور|حمض|مبيض|سائل تنظيف)/i },
  { id: "t_trauma", level: "emergency", re: /(trauma|injur(y|ed)|hit (in|on) (the )?eye|punched|struck|metal|glass|splinter|something (is )?stuck|penetrat|إصابة|ضربة|ضربوني|اتضربت|شظية|زجاج|معدن|جسم غريب)/i },
  { id: "t_severe_pain", level: "urgent", re: /(severe|excruciating|unbearable|intense) (eye )?pain|ألم شديد|وجع شديد|ألم لا يطاق|وجع جامد/i },
  { id: "t_flashes", level: "urgent", re: /(flashes?|flashing lights?|new floaters?|shower of floaters|ومضات|وميض|برق|ذباب أمام|ذباب طائر|عوائم جديدة)/i },
  { id: "t_halos", level: "urgent", re: /(halos? around|rainbow (rings|halos)|هالات|دوائر ملونة)/i },
];

export function scanText(text) {
  const out = [];
  const s = String(text || "");
  for (const r of TEXT_RULES) {
    const g = new RegExp(r.re.source, r.re.flags.includes("g") ? r.re.flags : r.re.flags + "g");
    let m;
    while ((m = g.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 24), m.index);
      if (NEG.test(before)) continue;
      out.push({ id: r.id, level: r.level, source: "text" });
      break;
    }
  }
  return out;
}

// answers shape: see symptoms.js
export function triage(a = {}, text = "") {
  const reasons = [];
  const add = (id, level) => reasons.push({ id, level, source: "answers" });
  const pain = a.pain || "none", blur = a.blur || "none";
  const redness = a.redness === "yes", light = a.light === "yes";
  const hist = a.history || [];
  if (a.suddenLoss === "yes") add("r_sudden_loss", "emergency");
  if (a.injury === "yes") add("r_injury_chemical", "emergency");
  if (a.flashes === "yes" && (a.suddenLoss === "yes" || blur === "marked")) add("r_flashes_with_loss", "emergency");
  else if (a.flashes === "yes") add("r_flashes", "urgent");
  if (pain === "severe" && (redness || blur !== "none" || light)) add("r_severe_pain_plus", "emergency");
  else if (pain === "severe") add("r_severe_pain", "urgent");
  if (blur === "marked" && a.onset === "today") add("r_sudden_blur", "urgent");
  if (hist.includes("contact_lens") && (pain !== "none" || redness || light)) add("r_contact_lens", "urgent");
  if (hist.includes("recent_surgery") && (pain !== "none" || redness || blur !== "none")) add("r_post_surgery", "urgent");
  if (pain === "moderate" && redness && (blur !== "none" || light)) add("r_pain_red_blur", "urgent");
  if (light && redness) add("r_light_red", "soon");
  if (a.diabetes && a.diabetes !== "none" && blur !== "none") add("r_diabetes_blur", "soon");
  if (hist.includes("glaucoma") && (pain !== "none" || blur !== "none")) add("r_glaucoma_hist", "urgent");
  if (redness && !reasons.length) add("r_redness", "soon");
  if (blur !== "none" && !reasons.length) add("r_blur", "soon");
  if (pain !== "none" && !reasons.length) add("r_pain", "soon");
  for (const t of scanText(text)) reasons.push(t);
  let level = "routine";
  for (const r of reasons) level = maxLevel(level, r.level);
  return { level, reasons, emergency: level === "emergency" };
}
