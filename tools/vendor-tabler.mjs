/* Vendor the Tabler icon set (09 §2.4, §3.5, ADR-020; S15.1): @tabler/icons 3.49.0 (MIT) → core/src/icons/data.ts, one
   packed binary inlined in the core worker and inflated on first use (core/src/icons/index.ts; the owner's decision of
   2026-10-21, option A: the set is inside the page, no network).
   Input: the npm release tarball, verified against the registry's integrity before anything is read from it, and the
   alias table of the same release tag (aliases.json is in the git tag, not in the npm package), verified against its git
   blob id in that tag's tree. Nothing is installed: @tabler/icons is not a dependency, the page carries only the data.
       node tools/vendor-tabler.mjs                                  fetch both (network) into a temporary folder
       node tools/vendor-tabler.mjs <icons-3.49.0.tgz> <aliases.json>  use files fetched before (checked the same way)
   What it does to the icons:
   * the outline set from tabler-nodes-outline.json, the filled set from tabler-nodes-filled.json: every node is a
     <path> (checked); each SVG's invisible frame <path stroke="none" d="M0 0h24v24H0z" fill="none"/> is not in these
     files (checked against icons/outline/*.svg and icons/filled/*.svg). A path with stroke="none" inside an outline icon
     is a real filled part (the percentage-* pies), so it is kept, filled and not stroked;
   * each path → absolute commands, kept exactly as Tabler draws them: relative commands made absolute, H / V → L
     (written back as H / V when one coordinate stays), S → C and T → Q (the reflected control point), M L C Q A Z kept.
     The core's decoder (core/src/icons/index.ts) turns Q into its exact cubic and every arc into cubics of at most 90°
     each when an icon is first drawn, so the display list gets only M L C Z and the renderer only scales. Arcs are not
     converted here because their cubics' control points fall off any grid: kept, the set is lossless and 17 % smaller;
   * paint per path: outline icons are stroked; fill="currentColor" adds a fill (the dots), stroke="none" removes the
     stroke, opacity=".5" halves the ink (brand-parsinta); filled icons are filled (nonzero rule, as SVG);
   * coordinates on a 1/GRID grid of the 24 × 24 box (GRID = 1000: Tabler writes at most three decimals, so every number
     is exact – the script stops if one is not), as zig-zag varint deltas from the current point, opcodes as bytes;
   * the index: names (icons.json order, front-coded), the 41 categories, the tags (a dictionary, most used first) and the
     alias table (old name → new, per set).
   The format is read by core/src/icons/index.ts (FORMAT below); core/tests/icons.test.ts checks the inlined bytes'
   sha256 (ARCH-4), the counts, and draws icons through the display list. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = "3.49.0";
/** the registry's dist.integrity of @tabler/icons@3.49.0 (https://registry.npmjs.org/@tabler/icons/3.49.0) */
export const TARBALL = { url: `https://registry.npmjs.org/@tabler/icons/-/icons-${VERSION}.tgz`,
  integrity: "sha512-l+GnSkFETx0U26icxv1VUFnxxiTqXfCcVRiRAnyMwibupM2S2L/hSaZ9gmSgz01rkrsH/93NvLsxykqdanc6lw==" };
/** aliases.json of the tag v3.49.0 (commit bbed884d15354b5cebf2493371f20dc2d5e83eaf): its git blob id in that tree */
export const ALIASES = { url: `https://raw.githubusercontent.com/tabler/tabler-icons/v${VERSION}/aliases.json`,
  commit: "bbed884d15354b5cebf2493371f20dc2d5e83eaf", blob: "6a8ea7324e4990de4255e236238eab2b7b4e76e5" };
export const GRID = 1000, FORMAT = 1;
/** opcodes (one byte each, then varints): a path starts with PATH + paint bits (1 stroke, 2 fill, 4 half ink); an arc is
    ARC + bits (1 large arc, 2 sweep, 4 rx = ry, 8 rotated) */
export const OP = { M: 1, L: 2, H: 3, V: 4, C: 5, Z: 6, Q: 7, PATH: 8, ARC: 16 };

/* ---- reading the release ---- */
const integrity = (/** @type {Buffer} */ b) => "sha512-" + createHash("sha512").update(b).digest("base64");
const gitBlob = (/** @type {Buffer} */ b) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
/** the files of a .tgz (ustar, with pax / GNU long names) */
export function untar(/** @type {Buffer} */ tgz) {
  const tar = gunzipSync(tgz), files = new Map();
  let off = 0, longName = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (/** @type {number} */ a, /** @type {number} */ n) => h.subarray(a, a + n).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 12).trim() || "0", 8), type = String.fromCharCode(h[156] || 48), prefix = str(345, 155);
    const body = tar.subarray(off + 512, off + 512 + size);
    let name = longName || (prefix ? prefix + "/" : "") + str(0, 100);
    longName = null;
    if (type === "x") { const m = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8")); if (m) longName = m[1]; }
    else if (type === "L") longName = body.toString("utf8").replace(/\0.*$/s, "");
    else if (type === "0" || type === "\0") files.set(name, Buffer.from(body));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/* ---- SVG path data → absolute M L C Z ---- */
/** @typedef {["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"]} Cmd */
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
export function parsePath(/** @type {string} */ d) {
  /** @type {[string, number[]][]} */
  const out = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([\s,]+)/y;
  /** @type {string | null} */ let cmd = null; /** @type {number[]} */ let nums = [];
  const flush = () => {
    if (cmd === null) return;
    const U = cmd.toUpperCase(), n = /** @type {Record<string, number>} */ (ARGS)[U];
    if (n === 0) { if (nums.length) throw new Error(`numbers after ${cmd} in ${d}`); out.push([cmd, []]); return; }
    if (!nums.length || nums.length % n) throw new Error(`${cmd} with ${nums.length} numbers in ${d}`);
    for (let k = 0; k < nums.length; k += n) out.push([k && U === "M" ? (cmd === "m" ? "l" : "L") : cmd, nums.slice(k, k + n)]);
  };
  let pos = 0;
  while (pos < d.length) {
    re.lastIndex = pos;
    const m = re.exec(d);
    if (!m) throw new Error(`cannot read path data at ${pos}: ${d}`);
    pos = re.lastIndex;
    if (m[1]) { flush(); cmd = m[1]; nums = []; }
    else if (m[2]) {
      // an arc's flags may be written together ("a1 1 0 011 1"): read them one digit each
      const U = cmd && cmd.toUpperCase(), i = nums.length % 7;
      if (U === "A" && (i === 3 || i === 4) && /^[01]./.test(m[2])) { nums.push(+m[2][0]); pos = m.index + 1; continue; }
      nums.push(+m[2]);
    }
  }
  flush();
  return out;
}
/** @typedef {Cmd | ["Q", number, number, number, number] | ["A", number, number, number, number, number, number, number]} SrcCmd */
/** SVG path data → absolute M L C Q A Z (H / V as L, S as C, T as Q) */
export function toCmds(/** @type {string} */ d) {
  /** @type {SrcCmd[]} */ const out = [];
  let x = 0, y = 0, sx = 0, sy = 0, /** @type {number[] | null} */ lastC = null, /** @type {number[] | null} */ lastQ = null;
  for (const [c, a] of parsePath(d)) {
    const rel = c === c.toLowerCase() && c !== "z", U = c.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    let nc = null, nq = null;
    if (U === "M") { x = ox + a[0]; y = oy + a[1]; sx = x; sy = y; out.push(["M", x, y]); }
    else if (U === "L") { x = ox + a[0]; y = oy + a[1]; out.push(["L", x, y]); }
    else if (U === "H") { x = ox + a[0]; out.push(["L", x, y]); }
    else if (U === "V") { y = oy + a[0]; out.push(["L", x, y]); }
    else if (U === "C" || U === "S") {
      const [x1, y1] = U === "C" ? [ox + a[0], oy + a[1]] : lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      const r = U === "C" ? a.slice(2) : a, x2 = ox + r[0], y2 = oy + r[1], ex = ox + r[2], ey = oy + r[3];
      out.push(["C", x1, y1, x2, y2, ex, ey]); nc = [x2, y2]; x = ex; y = ey;
    }
    else if (U === "Q" || U === "T") {
      const [qx, qy] = U === "Q" ? [ox + a[0], oy + a[1]] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
      const r = U === "Q" ? a.slice(2) : a, ex = ox + r[0], ey = oy + r[1];
      out.push(["Q", qx, qy, ex, ey]); nq = [qx, qy]; x = ex; y = ey;
    }
    else if (U === "A") { x = ox + a[5]; y = oy + a[6]; out.push(["A", Math.abs(a[0]), Math.abs(a[1]), a[2], a[3] ? 1 : 0, a[4] ? 1 : 0, x, y]); }
    else if (U === "Z") { out.push(["Z"]); x = sx; y = sy; }
    lastC = nc; lastQ = nq;
  }
  return out;
}

/* ---- the packed binary ---- */
class Bytes {
  /** @type {number[]} */ b = [];
  u(/** @type {number} */ v) { if (!Number.isInteger(v) || v < 0) throw new Error(`varint ${v}`); while (v > 127) { this.b.push((v & 127) | 128); v = Math.floor(v / 128); } this.b.push(v); }
  s(/** @type {number} */ v) { this.u(v < 0 ? -2 * v - 1 : 2 * v); }
  byte(/** @type {number} */ v) { this.b.push(v & 255); }
  str(/** @type {string} */ t) { const e = Buffer.from(t, "utf8"); this.u(e.length); for (const x of e) this.b.push(x); }
  bytes(/** @type {number[]} */ a) { for (const x of a) this.b.push(x); }
}
/** one icon's paths → its bytes, and the largest distance of a written number from Tabler's (0 when every one is on the grid) */
export function packIcon(/** @type {{cmds: SrcCmd[], paint: number}[]} */ paths, grid = GRID) {
  const w = new Bytes();
  let X = 0, Y = 0, SX = 0, SY = 0, err = 0;
  const q = (/** @type {number} */ v) => { const r = Math.round(v * grid); err = Math.max(err, Math.abs(r / grid - v)); return r; };
  const pt = (/** @type {number} */ x, /** @type {number} */ y) => { const a = q(x), b = q(y); w.s(a - X); w.s(b - Y); X = a; Y = b; };
  for (const p of paths) {
    w.byte(OP.PATH + p.paint);
    for (const c of p.cmds) {
      if (c[0] === "M") { w.byte(OP.M); pt(c[1], c[2]); SX = X; SY = Y; }
      else if (c[0] === "L") {
        const a = q(c[1]), b = q(c[2]);
        if (b === Y && a !== X) { w.byte(OP.H); w.s(a - X); X = a; }
        else if (a === X && b !== Y) { w.byte(OP.V); w.s(b - Y); Y = b; }
        else { w.byte(OP.L); w.s(a - X); w.s(b - Y); X = a; Y = b; }
      }
      else if (c[0] === "C") {
        // first control point from the start, end point from the start, second control point from the end
        const X0 = X, Y0 = Y, a1 = q(c[1]), b1 = q(c[2]), a2 = q(c[3]), b2 = q(c[4]), a = q(c[5]), b = q(c[6]);
        w.byte(OP.C); w.s(a1 - X0); w.s(b1 - Y0); w.s(a - X0); w.s(b - Y0); w.s(a2 - a); w.s(b2 - b); X = a; Y = b;
      }
      else if (c[0] === "Q") { const X0 = X, Y0 = Y, a1 = q(c[1]), b1 = q(c[2]), a = q(c[3]), b = q(c[4]); w.byte(OP.Q); w.s(a1 - X0); w.s(b1 - Y0); w.s(a - X0); w.s(b - Y0); X = a; Y = b; }
      else if (c[0] === "A") {
        const rx = q(c[1]), ry = q(c[2]), rot = q(c[3]);
        w.byte(OP.ARC + c[4] + 2 * c[5] + (rx === ry ? 4 : 0) + (rot ? 8 : 0)); w.u(rx); if (rx !== ry) w.u(ry); if (rot) w.s(rot); pt(c[6], c[7]);
      }
      else { w.byte(OP.Z); X = SX; Y = SY; }
    }
  }
  return { bytes: w.b, err };
}

/** the icons of a nodes file: name → paths with their paint bits */
function iconsOf(/** @type {Record<string, [string, Record<string, string>][]>} */ nodes, /** @type {"outline" | "filled"} */ set) {
  /** @type {Map<string, {cmds: SrcCmd[], paint: number, d: string}[]>} */ const out = new Map();
  for (const [name, list] of Object.entries(nodes)) {
    const paths = [];
    for (const [tag, at] of list) {
      if (tag !== "path") throw new Error(`${set} ${name}: a <${tag}> (only paths are read)`);
      for (const k of Object.keys(at)) if (!["d", "fill", "stroke", "opacity"].includes(k)) throw new Error(`${set} ${name}: attribute ${k}`);
      if (at.d === "M0 0h24v24H0z") throw new Error(`${set} ${name}: the invisible frame is in the nodes file`);
      if (at.fill && at.fill !== "currentColor" && at.fill !== "none") throw new Error(`${set} ${name}: fill ${at.fill}`);
      if (at.stroke && at.stroke !== "none") throw new Error(`${set} ${name}: stroke ${at.stroke}`);
      if (at.opacity && +at.opacity !== .5) throw new Error(`${set} ${name}: opacity ${at.opacity}`);
      let paint = set === "outline" ? 1 | (at.fill === "currentColor" ? 2 : 0) : 2;
      if (at.stroke === "none") paint &= ~1;
      if (set === "filled" && at.fill === "none") throw new Error(`filled ${name}: a path with fill none`);
      if (at.opacity) paint |= 4;
      if (!(paint & 3)) throw new Error(`${set} ${name}: a path neither stroked nor filled`);
      paths.push({ cmds: toCmds(at.d), paint, d: at.d });
    }
    if (!paths.length) throw new Error(`${set} ${name}: no paths`);
    out.set(name, paths);
  }
  return out;
}
/** the <path> elements of an icon's SVG file, without the invisible frame: they must be the nodes file's */
function svgPaths(/** @type {string} */ svg) {
  return [...svg.matchAll(/<path\b([^>]*)\/>/g)].map(m => Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])))
    .filter(a => !(a.stroke === "none" && a.fill === "none" && a.d === "M0 0h24v24H0z"));
}

/** the packed set from the release's files: { raw (the uncompressed binary), stats } */
export function build(/** @type {Map<string, Buffer>} */ files, /** @type {Record<string, Record<string, string>>} */ aliases, grid = GRID) {
  const get = (/** @type {string} */ f) => { const b = files.get("package/" + f); if (!b) throw new Error(`${f} is not in the tarball`); return b; };
  const pkg = JSON.parse(get("package.json").toString("utf8"));
  if (pkg.name !== "@tabler/icons" || pkg.version !== VERSION || pkg.license !== "MIT") throw new Error(`the tarball is ${pkg.name} ${pkg.version} (${pkg.license})`);
  const meta = JSON.parse(get("icons.json").toString("utf8"));
  /** @type {Record<"outline" | "filled", Map<string, {cmds: SrcCmd[], paint: number, d: string}[]>>} */
  const sets = { outline: iconsOf(JSON.parse(get("tabler-nodes-outline.json").toString("utf8")), "outline"),
    filled: iconsOf(JSON.parse(get("tabler-nodes-filled.json").toString("utf8")), "filled") };
  // the nodes files are the SVG files' paths, without the frame
  for (const set of /** @type {const} */ (["outline", "filled"])) for (const [name, paths] of sets[set]) {
    const svg = svgPaths(get(`icons/${set}/${name}.svg`).toString("utf8"));
    if (svg.length !== paths.length || svg.some((a, k) => a.d !== paths[k].d)) throw new Error(`${set} ${name}: the SVG file's paths differ from the nodes file`);
  }
  const names = Object.keys(meta);
  const cats = [...new Set(names.map(n => String(meta[n].category || "")))].sort();
  for (const n of names) {
    const st = Object.keys(meta[n].styles || {});
    if (st.some(s => s !== "outline" && s !== "filled")) throw new Error(`${n}: style ${st}`);
    for (const s of /** @type {const} */ (["outline", "filled"])) if (st.includes(s) !== sets[s].has(n)) throw new Error(`${n}: ${s} in icons.json and the nodes file disagree`);
  }
  for (const s of /** @type {const} */ (["outline", "filled"])) for (const n of sets[s].keys()) if (!meta[n]) throw new Error(`${s} ${n} is not in icons.json`);
  const tagCount = new Map();
  /** @type {Map<string, string[]>} */ const tagsOf = new Map();
  for (const n of names) {
    const t = [...new Set((meta[n].tags || []).map((/** @type {unknown} */ x) => String(x).trim().toLowerCase()).filter(Boolean))];
    tagsOf.set(n, /** @type {string[]} */ (t));
    for (const x of t) tagCount.set(x, (tagCount.get(x) || 0) + 1);
  }
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a) || (a < b ? -1 : 1)), tagId = new Map(tags.map((t, k) => [t, k]));
  const w = new Bytes();
  w.bytes([...Buffer.from("TBLR")]); w.byte(FORMAT); w.u(grid); w.str(VERSION);
  w.u(cats.length); for (const c of cats) w.str(c);
  w.u(tags.length); for (const t of tags) w.str(t);
  w.u(names.length);
  let prev = "";
  for (const n of names) {
    // front coding: the length shared with the previous name, then the rest
    let k = 0; while (k < prev.length && k < n.length && prev[k] === n[k]) k++;
    w.u(k); w.str(n.slice(k)); prev = n;
    w.byte(cats.indexOf(String(meta[n].category || "")));
    w.byte((sets.outline.has(n) ? 1 : 0) | (sets.filled.has(n) ? 2 : 0));
    const ids = tagsOf.get(n).map(t => tagId.get(t)).sort((a, b) => a - b);
    w.u(ids.length); let last = 0; for (const id of ids) { w.u(id - last); last = id; }
  }
  const index = new Map(names.map((n, k) => [n, k]));
  for (const s of /** @type {const} */ (["outline", "filled"])) {
    const al = Object.entries(aliases[s] || {}).filter(([from]) => !sets[s].has(from)).sort();
    for (const [from, to] of al) if (!sets[s].has(to)) throw new Error(`alias ${s} ${from} → ${to}: no such icon`);
    w.u(al.length); for (const [from, to] of al) { w.str(from); w.u(/** @type {number} */ (index.get(to))); }
  }
  let pathBytes = 0, maxErr = 0;
  for (const s of /** @type {const} */ (["outline", "filled"])) for (const n of names) {
    const paths = sets[s].get(n);
    if (!paths) continue;
    const { bytes, err } = packIcon(paths, grid);
    w.u(bytes.length); w.bytes(bytes); pathBytes += bytes.length; maxErr = Math.max(maxErr, err);
  }
  if (grid === GRID && maxErr > 1e-9) throw new Error(`a number is off the 1/${GRID} grid by ${maxErr}`);
  const raw = Buffer.from(w.b);
  return { raw, stats: { icons: names.length, outline: sets.outline.size, filled: sets.filled.size, categories: cats.length, tags: tags.length,
    aliases: { outline: Object.keys(aliases.outline || {}).length, filled: Object.keys(aliases.filled || {}).length }, pathBytes, raw: raw.length, maxErr } };
}

/** core/src/icons/data.ts for the packed set */
export function dataModule(/** @type {Buffer} */ raw, /** @type {Record<string, unknown>} */ stats) {
  const z = deflateSync(raw, { level: 9 }), sha = createHash("sha256").update(z).digest("hex"), rawSha = createHash("sha256").update(raw).digest("hex");
  const text = `/* @tabler/icons@${VERSION} (MIT, see ./LICENSE-tabler; ${TARBALL.integrity}), ${stats.outline} outline and ${stats.filled} filled icons,
   ${stats.categories} categories, ${stats.tags} tags: packed by tools/vendor-tabler.mjs (format ${FORMAT}, grid 1/${GRID}), ${raw.length} bytes, sha256 ${rawSha};
   zlib-compressed (${z.length} bytes, sha256 ${sha}) and base64. Generated by tools/vendor-tabler.mjs – do not edit. */
export const TABLER_VERSION = "${VERSION}";
/** sha256 of the zlib bytes below (the inlined bytes, ARCH-4) and of the packed binary they inflate to */
export const TABLER_SHA256 = "${sha}";
export const TABLER_RAW_SHA256 = "${rawSha}";
export const TABLER = "${z.toString("base64")}";
`;
  return { text, z, sha, rawSha };
}

async function fetchTo(/** @type {string} */ url, /** @type {string} */ file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

async function main() {
  let [tgzFile, aliasFile] = process.argv.slice(2);
  if (!tgzFile || !aliasFile) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabler-"));
    tgzFile = await fetchTo(TARBALL.url, path.join(dir, `icons-${VERSION}.tgz`));
    aliasFile = await fetchTo(ALIASES.url, path.join(dir, "aliases.json"));
  }
  const tgz = fs.readFileSync(tgzFile), al = fs.readFileSync(aliasFile);
  if (integrity(tgz) !== TARBALL.integrity) throw new Error(`${tgzFile}: integrity ${integrity(tgz)}, the registry's is ${TARBALL.integrity}`);
  if (gitBlob(al) !== ALIASES.blob) throw new Error(`${aliasFile}: git blob ${gitBlob(al)}, the tag's is ${ALIASES.blob}`);
  const files = untar(tgz), { raw, stats } = build(files, JSON.parse(al.toString("utf8")));
  const OUT = path.join(ROOT, "core/src/icons");
  fs.mkdirSync(OUT, { recursive: true });
  const { text, z, sha } = dataModule(raw, stats);
  fs.writeFileSync(path.join(OUT, "data.ts"), text);
  const lic = files.get("package/LICENSE");
  if (!lic || !/^MIT License/.test(lic.toString("utf8"))) throw new Error("the tarball's LICENSE is not the MIT licence");
  fs.writeFileSync(path.join(OUT, "LICENSE-tabler"), lic);
  console.log(JSON.stringify({ ...stats, zlib: z.length, base64: Math.ceil(z.length / 3) * 4, sha256: sha }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
