// Doctor-ready plain-text summary. The UI translates labels; this builds from translated pieces passed in.
export function doctorSummary({ t, when, summary, report, triage, source, model, label }) {
  const L = [];
  L.push(t("doc_title")); L.push(when); L.push("");
  L.push(t("doc_note")); L.push("");
  L.push(t("doc_symptoms"));
  const yn = (v) => t(v === "yes" ? "yes" : "no");
  L.push(`- ${t("q_eye")}: ${label("eye", summary.eye)}`);
  L.push(`- ${t("q_onset")}: ${label("onset", summary.onset)}`);
  L.push(`- ${t("q_pain")}: ${label("pain", summary.pain)}`);
  L.push(`- ${t("q_redness")}: ${yn(summary.redness)}`);
  L.push(`- ${t("q_blur")}: ${label("blur", summary.blur)}`);
  L.push(`- ${t("q_light")}: ${yn(summary.light)}`);
  L.push(`- ${t("q_flashes")}: ${yn(summary.flashes)}`);
  L.push(`- ${t("q_suddenLoss")}: ${yn(summary.suddenLoss)}`);
  L.push(`- ${t("q_injury")}: ${yn(summary.injury)}`);
  L.push(`- ${t("q_history")}: ${(summary.history || []).map((h) => label("history", h)).join(", ")}`);
  L.push(`- ${t("q_diabetes")}: ${label("diabetes", summary.diabetes)}`);
  if (summary.text) L.push(`- ${t("doc_free")}: ${summary.text}`);
  L.push("");
  L.push(`${t("doc_urgency")}: ${t("urg_" + report.urgency)}`);
  L.push(`${t("doc_safety")}: ${triage.reasons.length ? triage.reasons.map((r) => t("why_" + r.id)).join("; ") : t("doc_none")}`);
  L.push("");
  L.push(`${t("doc_engine")}: ${source === "on_device" ? t("eng_device") : t("eng_cloud")} (${model})`);
  L.push(`${t("doc_quality")}: ${t("iq_" + report.image_quality.overall)}`);
  for (const e of ["right", "left"]) if (report.observations[e]) {
    L.push(`${t("doc_ai_obs")} - ${t("eye_" + e)}:`);
    (report.observations[e].length ? report.observations[e] : [t("doc_none")]).forEach((x) => L.push("  * " + x));
  }
  if (report.symptom_summary) L.push(`${t("doc_ai_sum")}: ${report.symptom_summary}`);
  L.push(`${t("doc_na")}: ${t("na_list")}`);
  L.push(""); L.push(t("doc_disc"));
  return L.join("\n");
}
