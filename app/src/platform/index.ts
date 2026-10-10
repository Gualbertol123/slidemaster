/* The page's implementations of the core's platform (core/src/platform.ts): canvas text metrics, an off-screen
   slide for fitting text boxes, <canvas> surfaces and DOMParser. Installed once at start-up (main.tsx). */
import { setPlatform, type CanvasFactory, type Ctx2D, type NoteMeasure, type TextMeasurer, type XmlParser } from "@slide-builder/core/platform";

let measurer: { host: HTMLElement; box: HTMLElement; note: NoteMeasure | null } | null = null;
export const browserText: TextMeasurer = {
  maxDigitWidth(font) {
    const c = document.createElement("canvas").getContext("2d"); if (!c) return 0;
    c.font = font;
    let m = 0; for (const d of "0123456789") m = Math.max(m, c.measureText(d).width);
    return m;
  },
  noteFits(note, size) {
    if (typeof document === "undefined" || !document.body) return true;
    if (!measurer) {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "position:absolute;left:-20000px;top:0;width:1600px;height:900px;visibility:hidden;pointer-events:none;overflow:hidden";
      const box = document.createElement("div"); host.appendChild(box); document.body.appendChild(host);
      measurer = { host, box, note: null };
    }
    const m = measurer.box;
    if (measurer.note !== note) {                 // a new box: copy it in once, then only the font size changes
      measurer.note = note;
      measurer.host.className = "slide " + (note.design === "clean" ? "excel clean" : note.design);
      m.className = note.className; m.style.cssText = note.cssText; m.innerHTML = note.html;
      Object.assign(m.style, { left: "0px", top: "0px", width: note.w + "px", height: "auto", display: "block" });
    }
    m.style.fontSize = size + "px";
    return m.scrollHeight <= note.h + 1 && m.scrollWidth <= note.w + 1;
  },
};

export const browserCanvas: CanvasFactory = {
  create(w, h, opts) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", opts); if (!ctx) return null;
    return { ctx: ctx as unknown as Ctx2D, image: c, toDataURL: (type, q) => Promise.resolve(c.toDataURL(type, q)) };
  },
  async decode(src) {
    const img = new Image(); img.src = src; await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  },
};

export const browserXml: XmlParser = { parse: s => new DOMParser().parseFromString(s, "application/xml") };

export function installBrowserPlatform() {
  setPlatform({ text: browserText, canvas: typeof document !== "undefined" ? browserCanvas : null, xml: browserXml });
}
