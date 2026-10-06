/* Excel number formats → display text.
   Defaults follow the original app: Italian separators ("." thousands, "," decimals).
   Fixes over v2: locale tags ([$-410] Italian dates, [$€-410] currency symbols kept), exponent and
   fraction formats, 12-hour clock with AM/PM, m = minutes after h / before s, General's 11 characters. */
import { INDEXED, NAMED } from "./color";
import type { Cell } from "./types";

export const BUILTIN: Record<string, string> = {0:"General",1:"0",2:"0.00",3:"#,##0",4:"#,##0.00",9:"0%",10:"0.00%",11:"0.00E+00",12:"# ?/?",13:"# ??/??",14:"dd/mm/yyyy",15:"d-mmm-yy",16:"d-mmm",17:"mmm-yy",18:"h:mm AM/PM",19:"h:mm:ss AM/PM",20:"h:mm",21:"h:mm:ss",22:"dd/mm/yyyy h:mm",37:"#,##0 ;(#,##0)",38:"#,##0 ;[Red](#,##0)",39:"#,##0.00;(#,##0.00)",40:"#,##0.00;[Red](#,##0.00)",45:"mm:ss",46:"[h]:mm:ss",47:"mmss.0",48:"##0.0E+0",49:"@"};

const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_EN = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS_IT = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const DAYS_IT = ["domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato"];
type Lang = "en" | "it";

export const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function isDateFmt(f: string | null | undefined): boolean {
  if (!f) return false;
  const g = f.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(g) && !/[#0]/.test(g.replace(/\.0+/, ""));
}
function sectionFor(f: string, v: unknown) {
  const secs = f.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (typeof v !== "number") return { sec: secs[3] || (secs.length === 1 ? secs[0] : "@"), neg: false, auto: false };
  if (v < 0 && secs[1] !== undefined) return { sec: secs[1], neg: true, auto: false };
  if (v === 0 && secs[2] !== undefined) return { sec: secs[2], neg: false, auto: false };
  return { sec: secs[0], neg: false, auto: v < 0 };
}

/** Excel "General": up to 11 characters, otherwise scientific notation */
export function fmtGeneral(v: number): string {
  if (!isFinite(v)) return String(v);
  const sci = () => {
    const [m0, e0] = v.toExponential(5).split("e");
    const m = m0.includes(".") ? m0.replace(/0+$/, "").replace(/\.$/, "") : m0;
    const n = +e0;
    return m.replace(".", ",") + "E" + (n < 0 ? "-" : "+") + String(Math.abs(n)).padStart(2, "0");
  };
  if (Number.isInteger(v)) return String(v).length <= 11 ? String(v) : sci();
  const a = Math.abs(v);
  if (a < 1e-9 || a >= 1e11) return sci();
  for (let p = 10; p >= 1; p--) { const s = String(parseFloat(v.toPrecision(p))); if (s.length <= 11 && !/e/i.test(s)) return s.replace(".", ","); }
  return sci();
}

/** [$€-410] → "€" literal; returns the locale language when the tag names one */
function stripLocale(sec: string): { sec: string; lang: Lang | null } {
  let lang: Lang | null = null;
  sec = sec.replace(/\[\$([^\]-]*)(?:-([0-9A-Za-z-]+))?\]/g, (_m, sym: string, loc: string | undefined) => {
    if (loc) { const l = loc.toLowerCase(); if (/^(0*410|0*810|it(-[a-z]+)?)$/.test(l)) lang = "it"; else if (/^[0-9a-f]+$/.test(l) || /^[a-z]{2}(-[a-z]+)?$/.test(l)) lang = lang || "en"; }
    return sym ? `"${sym.replace(/"/g, "")}"` : "";
  });
  return { sec, lang };
}

export interface Formatted { text: string; color?: string | null }

export function formatValue(cell: Pick<Cell, "v" | "t" | "fmt">): Formatted {
  const v = cell.v, f = cell.fmt || "General";
  if (cell.t === "e") return { text: String(v) };
  if (cell.t === "b") return { text: v ? "TRUE" : "FALSE" };
  if (cell.t === "s") {
    const { sec } = sectionFor(f, v);
    if (sec && sec.includes("@")) return { text: stripLocale(sec).sec.replace(/"([^"]*)"/g, "$1").replace(/@/g, String(v)).replace(/[_\\*]./g, "") };
    return { text: String(v) };
  }
  if (cell.t !== "n" && cell.t !== "d") return { text: "" };
  const num = v as number;
  if (f === "General" || f === "@") return { text: fmtGeneral(num) };
  let { sec, auto } = sectionFor(f, num);
  let color: string | null = null;
  sec = sec.replace(/\[(\w+)\]/g, (m, n: string) => { const k = n.toLowerCase(); if (NAMED[k]) { color = NAMED[k]; return ""; } return m; });
  sec = sec.replace(/\[Color\s*(\d+)\]/ig, (_m, n: string) => { color = "#" + (INDEXED[+n - 1] || "000000"); return ""; });
  const loc = stripLocale(sec); sec = loc.sec;
  sec = sec.replace(/\[[<>=][^\]]*\]/g, "");
  if (isDateFmt(sec)) return { text: fmtDate(num, sec, loc.lang || "en"), color };
  // literal pieces
  const lit: string[] = [];
  const pattern = sec.replace(/"([^"]*)"/g, (_m, s: string) => { lit.push(s); return "\u0001" + (lit.length - 1) + "\u0002"; })
    .replace(/\\(.)/g, (_m, s: string) => { lit.push(s); return "\u0001" + (lit.length - 1) + "\u0002"; })
    .replace(/_./g, " ").replace(/\*./g, "");
  const unlit = (s: string) => s.replace(/\u0001(\d+)\u0002/g, (_m, i: string) => lit[+i]);
  const masked = pattern.replace(/\u0001\d+\u0002/g, m => "\u0003".repeat(m.length));
  let x = Math.abs(num);
  const pct = (masked.match(/%/g) || []).length; x *= Math.pow(100, pct);

  // fractions: "# ?/?", "# ??/??", "?/4"
  const fr = /(?:([#0?]+)\s+)?([?#0]+)\/([?#0]+|\d+)/.exec(masked);
  if (fr) {
    const whole = fr[1] ? Math.floor(x + 1e-9) : 0, rest = x - whole;
    let n = 0, d = 1;
    if (/^\d+$/.test(fr[3])) { d = +fr[3]; n = Math.round(rest * d); }
    else { const maxD = Math.pow(10, fr[3].length) - 1; let best = Infinity; for (let q = 1; q <= maxD; q++) { const p = Math.round(rest * q), e = Math.abs(rest - p / q); if (e < best - 1e-12) { best = e; n = p; d = q; } } }
    let w = whole; if (n === d && fr[1]) { w += 1; n = 0; }
    const sign = auto && x !== 0 ? "-" : "";
    const body = fr[1] ? (n ? `${w ? w + " " : ""}${n}/${d}` : String(w)) : `${n + w * d}/${d}`;
    return { text: unlit(pattern.slice(0, fr.index) + sign + body + pattern.slice(fr.index + fr[0].length)).replace(/\s+$/, " "), color };
  }

  const numPart = /[#0?,.]+(?:E[+-][0#]+)?/i.exec(masked);
  if (!numPart) return { text: unlit(pattern), color };
  let np = numPart[0];
  let numText: string;
  const em = /E([+-])([0#]+)$/i.exec(np);
  if (em) {
    const mant = np.slice(0, em.index), intD = mant.split(".")[0].replace(/[^0#?]/g, "");
    const dm = /\.([0#?]*)/.exec(mant), dec = dm ? dm[1].length : 0;
    let e = x === 0 ? 0 : Math.floor(Math.log10(x));
    const k = intD.length > 1 && intD.includes("#") ? intD.length : 1;            // ##0.0E+0 = engineering
    e = k > 1 ? Math.floor(e / k) * k : e - (Math.max(1, intD.length) - 1);
    let m = x / Math.pow(10, e), ms = m.toFixed(dec);
    if (k === 1 && +ms >= Math.pow(10, Math.max(1, intD.length))) { e += 1; m = x / Math.pow(10, e); ms = m.toFixed(dec); }
    const exp = String(Math.abs(e)).padStart(em[2].length, "0");
    numText = ms.replace(".", ",") + "E" + (e < 0 ? "-" : em[1] === "+" ? "+" : "") + exp;
    if (auto && x !== 0) numText = "-" + numText;
  } else {
    // trailing commas scale by 1000
    let scale = 0; while (/[0#?],$/.test(np) || /,$/.test(np)) { np = np.slice(0, -1); scale++; }
    x /= Math.pow(1000, scale);
    const dm = /\.([0#?]*)/.exec(np); const dec = dm ? dm[1].length : 0; const req = dm ? (dm[1].match(/0/g) || []).length : 0;
    const s = x.toFixed(dec); let [ip, dp] = s.split(".");
    if (dp) { dp = dp.replace(/0+$/, ""); if (dp.length < req) dp = dp.padEnd(req, "0"); }
    const intDigits = np.split(".")[0];
    if (!/0/.test(intDigits) && ip === "0") ip = "";
    if (intDigits.includes(",")) ip = group(ip);
    numText = ip + (dp ? "," + dp : "");
    const isZero = !/[1-9]/.test(s);
    if (auto && !isZero) numText = "-" + numText;
  }
  const out = pattern.slice(0, numPart.index) + numText + pattern.slice(numPart.index + numPart[0].length);
  return { text: unlit(out).replace(/\s+$/, " "), color };
}

const DT = /yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|"[^"]*"|\\.|\[[hms]+\]|\.0+/gi;
export function fmtDate(n: number, f: string, lang: Lang = "en"): string {
  const d = new Date(Math.round((n - 25569) * 86400000));
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), se = d.getUTCSeconds();
  const p = (x: number) => String(x).padStart(2, "0");
  const months = lang === "it" ? MONTHS_IT : MONTHS_EN, days = lang === "it" ? DAYS_IT : DAYS_EN;
  const ampm = /AM\/PM|A\/P/i.test(f);
  const toks: { t: string; i: number }[] = []; let m: RegExpExecArray | null; DT.lastIndex = 0;
  while ((m = DT.exec(f))) toks.push({ t: m[0], i: m.index });
  // "m"/"mm" are minutes right after an hour token or right before a seconds token
  const minuteAt = (k: number) => {
    for (let j = k - 1; j >= 0; j--) { const l = toks[j].t.toLowerCase(); if (/^(h+|\[h+\])$/.test(l)) return true; if (/^[dmy]/.test(l) || /^s+$/.test(l)) break; }
    for (let j = k + 1; j < toks.length; j++) { const l = toks[j].t.toLowerCase(); if (/^(s+|\[s+\])$/.test(l)) return true; if (/^[dmyh]/.test(l)) break; }
    return false;
  };
  let out = "", last = 0;
  toks.forEach((tk, k) => {
    out += f.slice(last, tk.i); last = tk.i + tk.t.length;
    const t = tk.t, l = t.toLowerCase();
    if (t[0] === '"') { out += t.slice(1, -1); return; }
    if (t[0] === "\\") { out += t[1]; return; }
    if (l === "yyyy") out += Y; else if (l === "yy") out += String(Y).slice(2);
    else if (l === "mmmmm") out += months[M][0].toUpperCase();
    else if (l === "mmmm") out += months[M];
    else if (l === "mmm") out += months[M].slice(0, 3);
    else if (l === "mm") out += minuteAt(k) ? p(mi) : p(M + 1);
    else if (l === "m") out += minuteAt(k) ? mi : M + 1;
    else if (l === "dddd") out += days[d.getUTCDay()];
    else if (l === "ddd") out += days[d.getUTCDay()].slice(0, 3);
    else if (l === "dd") out += p(D); else if (l === "d") out += D;
    else if (l === "hh") out += p(ampm ? (h % 12 || 12) : h); else if (l === "h") out += ampm ? (h % 12 || 12) : h;
    else if (l === "ss") out += p(se); else if (l === "s") out += se;
    else if (/^\[h+\]$/.test(l)) out += Math.floor(n * 24);
    else if (/^\[m+\]$/.test(l)) out += Math.floor(n * 1440);
    else if (/^\[s+\]$/.test(l)) out += Math.floor(n * 86400);
    else if (/^\.0+$/.test(l)) out += "," + String(Math.floor(((n * 86400) % 1) * Math.pow(10, l.length - 1))).padStart(l.length - 1, "0");
    else if (l === "am/pm") out += h < 12 ? "AM" : "PM";
    else if (l === "a/p") out += h < 12 ? "A" : "P";
    else out += t;
  });
  return out + f.slice(last);
}
