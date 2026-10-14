/* "Report a problem with this export" (the export pilot, PLAN S3.8, docs/next/pilot-export.md): a short form – what is
   wrong (the pilot's checks P1–P10), which file, which slide, a comment – saved with what the page knows about the
   last export (its files, time, design, version, the fonts it replaced) as one JSON file in the export folder's
   feedback\ (the helper adds version, user, PC and time). Offline, no e-mail. Opened from disk (no helper), the
   report is downloaded instead, to be sent to the product owner. */
import { get, toast } from "../state/store";
import { ask } from "../state/dialogs";
import { style } from "../state/app";
import { backend } from "../sync/api";
import { esc } from "@slide-builder/core/xlsx/util";
import { DESIGN_LABEL, download, lastMade } from "./export";

export const PROBLEMS: [string, string][] = [
  ["P1", "Pages missing, extra or in another order"],
  ["P2", "A number or text missing, different or cut off"],
  ["P3", "Looks different from the screen (colours, borders, cards, shadows…)"],
  ["P4", "A font replaced"],
  ["P5", "Text cannot be selected or found"],
  ["P6", "Acrobat Reader: slow to open or scroll, or drawn wrong"],
  ["P7", "Edge's PDF viewer: slow or drawn wrong"],
  ["P8", "Too large or too slow"],
  ["P9", "Printed page missing something or different"],
  ["P10", "Versions: a wrong name or wrong content"],
  ["other", "Something else"],
];
export const WHICH: [string, string][] = [["new", "the PDF (Export PDF)"], ["pictures", "PDF as pictures"], ["png", "PNG or copied slide"]];

const opts = (list: [string, string][], cur: string) => list.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");

/** opens the form; on "Save report" writes the report (helper) or downloads it (from disk) */
export async function reportExportProblem() {
  const { file, slides, cur } = get().deck;
  if (!file || !slides.length) { toast("Open a workbook and export it first: the report is about an export."); return; }
  const last = lastMade?.workbook === file.name ? lastMade : null;         // an export of another workbook is not this one's
  const form: Record<string, string> = { fbWhat: "P2", fbWhich: /pictures|exact/.test(last?.kind || "") ? "pictures" : /png|copy/.test(last?.kind || "") ? "png" : "new", fbSlide: String(cur + 1), fbText: "" };
  const lastLine = last
    ? `Last export: <b>${esc(last.files.join(", ") || last.kind)}</b> · ${esc(last.kind)} · ${last.seconds} s${last.failed?.length ? " · failed" : ""}`
    : "No export in this window yet – the report names the workbook and the slide.";
  const html = `<div class="fbform" style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;font-size:12.5px">
    <label for="fbWhat">What is wrong</label><select id="fbWhat">${opts(PROBLEMS, form.fbWhat)}</select>
    <label for="fbWhich">In which file</label><select id="fbWhich">${opts(WHICH, form.fbWhich)}</select>
    <label for="fbSlide">Slide</label><input id="fbSlide" type="number" min="1" max="${slides.length}" value="${form.fbSlide}" style="width:80px">
    <label for="fbText" style="align-self:start">What you see</label><textarea id="fbText" rows="4" maxlength="4000" placeholder="e.g. slide 3: the total in the last row is cut off in Acrobat"></textarea>
    <span></span><span class="hint">${lastLine}<br>${backend.served ? "Saved as a file in the export folder (feedback). Please keep the new and the old PDF of this deck." : "Opened from disk: the report is downloaded – send the file to the product owner."}</span>
  </div>`;
  // the form's values, kept as they are typed (the dialog's DOM is gone once it answers)
  const grab = (e: Event) => { const t = e.target as HTMLInputElement | null; if (t?.id && t.id in form) form[t.id] = t.value; };
  document.addEventListener("input", grab, true); document.addEventListener("change", grab, true);
  let r: string | null;
  try {
    r = await ask("Report a problem with this export", html, [{ id: "cancel", label: "Cancel" }, { id: "save", label: backend.served ? "Save report" : "Download report", primary: true }], { width: 620, sub: "for the export pilot" });
  } finally { document.removeEventListener("input", grab, true); document.removeEventListener("change", grab, true); }
  if (r !== "save") return;
  const st = style(), n = Math.min(slides.length, Math.max(1, Math.round(+form.fbSlide) || cur + 1));
  const report = {
    form: { what: form.fbWhat, whatText: PROBLEMS.find(p => p[0] === form.fbWhat)?.[1] || "", which: form.fbWhich, slide: n, slideName: slides[n - 1]?.label || "", comment: form.fbText.slice(0, 4000) },
    deck: { workbook: file.name, slides: slides.length, design: st.design, designName: DESIGN_LABEL[st.design], theme: st.theme ?? null, version: get().deck.version || "" },
    lastExport: last,
    browser: navigator.userAgent, servedByHelper: backend.served,
  };
  const offline = () => {
    const name = `export-feedback-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
    download(name, JSON.stringify({ kind: "export-feedback", schema: 1, at: new Date().toISOString(), report }, null, 1), "application/json");
    return name;
  };
  try {
    if (backend.served) {
      const { file: saved } = await backend.exportFeedback(report);
      toast(`Report saved as <b>export\\${esc(saved.replace(/\//g, "\\"))}</b>. Thank you!`, [{ label: "Show folder", fn: () => { void backend.open({ folder: true }); } }]);
    } else {
      const name = offline();
      toast(`Report downloaded as <b>${esc(name)}</b>: send it to the product owner. Thank you!`);
    }
  } catch (e) {
    // the helper could not save it (stopped, the shared folder busy): the report is downloaded, so nothing typed is lost
    console.error(e);
    const name = offline();
    toast(`⚠ The report could not be saved in the export folder (${esc((e as Error).message || e)}): it was downloaded as <b>${esc(name)}</b> – send it to the product owner.`, [], true);
  }
}
