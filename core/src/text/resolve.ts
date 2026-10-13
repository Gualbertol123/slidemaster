/* Which font file draws each text run of a native PDF (PLAN S3.7). A text node carries the CSS font-family list the
   screen draws with (`css`, else its `font` key); the export takes the first family of that list that it can embed,
   as the browser takes the first one it has:
   * the deck's font library first (its @font-face rules win over a Windows font of the same name), then this PC's
     fonts (the helper's /sysfonts index);
   * variable families the old export engine left out are left out here too ("Segoe UI Variable …", "SF Pro …":
     v3's printReady(), core/render/printcss.ts), so Liquid Glass text is static Segoe UI as in today's PDFs (B2);
   * CSS generic families are Windows' defaults; where a family is not installed, its metric-compatible stand-in is
     tried (Carlito for Calibri … – the substitutes Chromium itself uses through fontconfig on Linux);
   * when nothing in the list can be embedded, a default face is used and the family is reported (`missing`).
   Only the files a deck needs are loaded (one face per family, weight and style, chosen by CSS font matching on the
   index's metadata), so an export reads a few files, not the PC's font folder. */
import { weightOf, type DisplayList, type Node, type TextNode } from "../dl/types";
import { FontRegistry } from "./fonts";

/** one font file the export may load: a library face or a file of this PC's font folders */
export interface CatalogFont { source: "library" | "system"; file: string; family: string; weight: number; italic: boolean }

/** families the PDF never takes from a list (variable fonts the old engine left out too) */
const SKIP = /^(-apple-system|BlinkMacSystemFont|Segoe UI Variable( (Display|Text|Small))?|SF Pro( (Display|Text))?)$/i;
const GENERIC: Record<string, string> = { "sans-serif": "Arial", serif: "Times New Roman", monospace: "Consolas", "system-ui": "Segoe UI", cursive: "Comic Sans MS", fantasy: "Impact" };
/** metric-compatible stand-ins, tried only when the family itself is not installed */
const STAND_IN: Record<string, string[]> = {
  calibri: ["Carlito"], cambria: ["Caladea"], arial: ["Liberation Sans", "Arimo"], helvetica: ["Arial", "Liberation Sans", "Arimo"],
  "times new roman": ["Liberation Serif", "Tinos"], "courier new": ["Liberation Mono", "Cousine"], consolas: ["Liberation Mono", "DejaVu Sans Mono"],
  "segoe ui": ["Selawik", "Open Sans", "Noto Sans", "DejaVu Sans"], "century gothic": ["URW Gothic", "TeX Gyre Adventor"],
};
/** the face used when nothing in a list can be embedded */
const LAST_RESORT = ["Arial", "Segoe UI", "Liberation Sans", "Arimo", "DejaVu Sans", "Noto Sans"];

/** the families of a CSS font-family list, unquoted */
export function cssFamilies(css: string): string[] {
  const out: string[] = []; let cur = "", q = "";
  for (const ch of css) {
    if (q) { if (ch === q) q = ""; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; continue; }
    if (ch === ",") { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(f => f.replace(/\s+/g, " "));
}

/** the face a browser draws a weight and style with, on metadata: the style first, then the weight – CSS font matching
    (CSS Fonts 4 §5.2) for the library's @font-face faces; for a Windows font Chromium takes DirectWrite's match instead,
    the nearest weight; of two equally near the heavier from 400 up, the lighter below (Segoe UI 500 is Semibold, 640
    Semibold, 720 Bold, 325 Light – measured against Chromium's canvas, S4.4) – so the PDF uses the face the screen
    shows (as FontRegistry.match). (DirectWrite may also let a weight win over the style – Arial italic 850 is Arial
    Black – which this does not follow: no weight the designs use comes near) */
export function pickFace<T extends { weight: number; italic: boolean; source?: string }>(list: T[], weight: number, italic: boolean): T | null {
  if (!list.length) return null;
  const styled = list.filter(f => f.italic === italic), pool = styled.length ? styled : list;
  if (pool.every(f => f.source === "system")) return [...pool].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || (weight >= 400 ? b.weight - a.weight : a.weight - b.weight))[0];
  const rank = (w: number) => w === weight ? 0
    : weight > 500 ? (w > weight ? w - weight : 1000 + weight - w)
    : weight < 400 ? (w < weight ? weight - w : 1000 + w - weight)
    : (w > weight && w <= 500 ? w - weight : w < weight ? 100 + weight - w : 1000 + w);
  return [...pool].sort((a, b) => rank(a.weight) - rank(b.weight))[0];
}

export interface Resolved {
  /** the pages with each text node's `font` set to the family that draws it in the PDF */
  pages: DisplayList[];
  /** CSS lists none of whose families could be embedded (drawn with a default face) */
  missing: string[];
  /** families the catalog has but whose files could not be read (WOFF2, a broken file): the next family drew them */
  unreadable: string[];
}

export class FontResolver {
  /** catalog by lower-case family; library families shadow system ones */
  private byFamily = new Map<string, CatalogFont[]>();
  /** files loaded (or failed: null), by source + file */
  private loaded = new Map<string, Promise<boolean>>();
  /** families in the catalog none of whose candidate files could be read */
  private failed = new Set<string>();
  constructor(catalog: CatalogFont[], private readonly fonts: FontRegistry, private readonly load: (f: CatalogFont) => Promise<Uint8Array | null>) {
    const lib = new Set(catalog.filter(f => f.source === "library").map(f => f.family.toLowerCase()));
    for (const f of catalog) {
      const k = f.family.toLowerCase();
      if (f.source === "system" && lib.has(k)) continue;
      const l = this.byFamily.get(k) || []; l.push(f); this.byFamily.set(k, l);
    }
  }
  has(family: string) { return this.byFamily.has(family.toLowerCase()); }
  /** loads the file of the face CSS would pick for (family, weight, italic); false when there is none or it is unreadable */
  private async face(family: string, weight: number, italic: boolean): Promise<boolean> {
    const list = this.byFamily.get(family.toLowerCase()); if (!list) return false;
    // a face that turns out unreadable (e.g. WOFF2, which the core cannot read yet) is dropped and the next one tried
    for (let pool = list; pool.length;) {
      const f = pickFace(pool, weight, italic)!, key = f.source + "|" + f.file;
      let p = this.loaded.get(key);
      if (!p) {
        p = this.load(f).then(data => {
          if (!data) return false;
          // a library face is what its @font-face rule says; a Windows file names its own faces (a .ttc holds several) –
          // unless the index knows it by another name (the browser's local-font list), which then names its one face too
          try {
            if (f.source === "library") { this.fonts.add(data, { family: f.family, weight: f.weight, italic: f.italic, source: "library", file: f.file }); return true; }
            const faces = this.fonts.add(data, { source: "system", file: f.file });
            if (faces.length === 1 && faces[0].family.toLowerCase() !== f.family.toLowerCase()) this.fonts.add(data, { family: f.family, source: "system", file: f.file });
            return true;
          } catch { return false; }
        }, () => false);
        this.loaded.set(key, p);
      }
      if (await p) return true;
      pool = pool.filter(x => x !== f);
    }
    return false;
  }
  /** the family a text node is drawn with in the PDF (after its face is loaded), or null */
  private async family(n: TextNode): Promise<string | null> {
    const w = weightOf(n), it = !!n.i;
    for (const raw of cssFamilies(n.css || n.font)) {
      if (SKIP.test(raw)) continue;
      const fam = GENERIC[raw.toLowerCase()] || raw;
      for (const cand of [fam, ...(this.has(fam) ? [] : STAND_IN[fam.toLowerCase()] || [])]) {
        if (await this.face(cand, w, it)) return cand;
        if (this.has(cand)) this.failed.add(this.byFamily.get(cand.toLowerCase())![0].family);
      }
    }
    return null;
  }
  async resolve(pages: DisplayList[]): Promise<Resolved> {
    const memo = new Map<string, Promise<string | null>>(), missing = new Set<string>();
    // the default face, looked for only when a run needs it
    let fallbackP: Promise<string | null> | null = null;
    const fallback = () => fallbackP ||= (async () => { for (const f of LAST_RESORT) if (await this.face(f, 400, false)) return f; return null; })();
    const of = (n: TextNode) => {
      const k = `${n.css || n.font}|${weightOf(n)}|${n.i ? 1 : 0}`;
      let p = memo.get(k); if (!p) memo.set(k, p = this.family(n)); return p;
    };
    const visit = async (n: Node): Promise<Node> => {
      if (n.t === "group") return { ...n, children: await Promise.all(n.children.map(visit)) };
      if (n.t !== "text" || !n.src) return n;
      let fam = await of(n);
      if (!fam) {
        missing.add(n.css || n.font);
        fam = await fallback();
        if (fam && !(await this.face(fam, weightOf(n), !!n.i))) fam = null;
        if (!fam) throw new Error(`no font to draw “${n.src.slice(0, 40)}” with (${n.css || n.font}) – this PC has none of its fonts`);
      }
      return fam === n.font ? n : { ...n, font: fam };
    };
    const out: DisplayList[] = [];
    for (const p of pages) out.push(await Promise.all(p.map(visit)));
    return { pages: out, missing: [...missing], unreadable: [...this.failed] };
  }
}
