/* CSS text rules the designs rely on, for any measure (the page's canvas until S4.4, HarfBuzz after):
   - collapse(): white-space normal / nowrap: every run of spaces, tabs and line breaks is one space;
   - breakRuns(): white-space normal + word-break: break-word over styled runs (a cell's superscript, a text box's
     runs), greedy: a line breaks after spaces and after a hyphen inside a word – never between two runs of one
     word –, spaces collapse across runs and hang at a line's end, a word wider than the line breaks between
     characters (a character keeps its combining marks). wrapLines() is its one-run case.
   Known differences from ICU line breaking (named for S4.4, which breaks from font files): a hyphen before digits
   ("2020-2021") is a break here, "/" is not, CJK breaks between characters only. This duplicates
   Shaper.breakLines (shape.ts: the same rules over HarfBuzz advances); the two are to become one in S4.4. */

export const collapse = (s: string) => s.replace(/[ \t\n\r\f]+/g, " ");

export interface RunPiece<T> { run: T; text: string }
/** the lines of runs at a width: each line is its pieces (a run's part), trailing spaces removed;
    `measure(text, run)` gives a piece's advance */
export function breakRuns<T extends { text: string }>(runs: T[], width: number, measure: (text: string, run: T) => number): RunPiece<T>[][] {
  // the collapsed character stream with the run of each character
  const chars: { ch: string; r: number }[] = [];
  runs.forEach((run, r) => {
    for (const ch of collapse(run.text)) {
      if (ch === " " && (!chars.length || chars[chars.length - 1].ch === " ")) continue;     // spaces collapse across runs; none at the start
      chars.push({ ch, r });
    }
  });
  const isMark = (s: string) => /\p{M}/u.test(s);
  // break opportunities: before a non-space after a space; after a hyphen between letters
  const opp = (i: number) => (chars[i - 1].ch === " " && chars[i].ch !== " ") || (chars[i - 1].ch === "-" && chars[i].ch !== " " && i > 1 && chars[i - 2].ch !== " ");
  const pieces = (a: number, b: number): RunPiece<T>[] => {
    const out: RunPiece<T>[] = [];
    for (let i = a; i < b; i++) { const last = out[out.length - 1]; if (last && last.run === runs[chars[i].r]) last.text += chars[i].ch; else out.push({ run: runs[chars[i].r], text: chars[i].ch }); }
    return out;
  };
  const ends: number[] = [];
  for (let i = 1; i < chars.length; i++) if (opp(i)) ends.push(i);
  ends.push(chars.length);
  // a width is the sum of measured units: the stretches between break opportunities (split where the run changes),
  // the last one without its trailing spaces; inside a word broken between characters, its clusters. So what is
  // measured depends on the text only, not on where the lines fall (a measurer asked in rounds settles in a fixed
  // number of them however many lines there are), and each unit is measured once.
  const isB = new Uint8Array(chars.length + 1), nextB = new Int32Array(chars.length + 1);
  isB[0] = isB[chars.length] = 1;
  for (const e of ends) isB[e] = 1;
  for (let i = 1; i < chars.length; i++) if (chars[i].r !== chars[i - 1].r) isB[i] = 1;
  nextB[chars.length] = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) nextB[i] = isB[i + 1] ? i + 1 : nextB[i + 1];
  const cache = new Map<string, number>();
  const mw = (a: number, b: number) => {
    let t = ""; for (let i = a; i < b; i++) t += chars[i].ch;
    const key = chars[a].r + "\u0000" + t;
    let w = cache.get(key); if (w === undefined) cache.set(key, w = measure(t, runs[chars[a].r]));
    return w;
  };
  const clusters = (a: number, b: number) => { let w = 0; for (let i = a; i < b;) { let j = i + 1; while (j < b && isMark(chars[j].ch)) j++; w += mw(i, j); i = j; } return w; };
  const widthOf = (a: number, b: number) => {
    while (b > a && chars[b - 1].ch === " ") b--;
    let w = 0;
    for (let p = a; p < b;) {
      const u = nextB[p], q = Math.min(u, b);
      let ut = u; while (ut > p && chars[ut - 1].ch === " ") ut--;
      w += isB[p] && (q === u || q === ut) ? mw(p, q) : clusters(p, q);
      p = q;
    }
    return w;
  };
  const trimEnd = (ps: RunPiece<T>[]) => { while (ps.length) { const l = ps[ps.length - 1]; l.text = l.text.replace(/ +$/, ""); if (l.text) break; ps.pop(); } return ps; };
  const lines: RunPiece<T>[][] = [];
  let start = 0;
  while (start < chars.length) {
    while (start < chars.length && chars[start].ch === " ") start++;             // a line starts at its first word
    if (start >= chars.length) break;
    let best = -1;
    for (const e of ends) { if (e <= start) continue; if (widthOf(start, e) <= width + 1e-6) best = e; else break; }
    if (best < 0) {
      // the next word alone is wider than the line: as many characters as fit (at least one, with its marks)
      const e = ends.find(o => o > start)!;
      let i = start;
      while (i < e && chars[i].ch !== " ") {
        let j = i + 1; while (j < e && isMark(chars[j].ch)) j++;
        if (i > start && widthOf(start, j) > width + 1e-6) break;
        i = j;
      }
      while (i < e && chars[i].ch === " ") i++;
      best = i;
    }
    lines.push(trimEnd(pieces(start, best)));
    start = best;
  }
  return lines.length ? lines : [[]];
}

/** the lines of a (collapsed) text at a width; `measure` gives a string's advance */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  return breakRuns([{ text }], width, s => measure(s)).map(l => l.map(p => p.text).join(""));
}
