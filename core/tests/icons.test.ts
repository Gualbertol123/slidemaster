/* S15.1 · the vendored Tabler icon set (09 §2.4, §3.5, §7.2 ARCH-4; IC-02 data part, LI-01): the inlined bytes' hash,
   the release's counts, exact paths of known icons, paint, aliases, the search index, the lazy inflate, that only the
   workers carry the data, and icons drawn through the display list (a sample here; every icon with TABLER_FULL=1:
   `TABLER_FULL=1 npx vitest run tests/icons.test.ts` in core/). No network: the data is the committed
   core/src/icons/data.ts. The set is registered by tests/setup-icons.ts, the same entry point as the workers'. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TABLER, TABLER_RAW_SHA256, TABLER_SHA256, TABLER_VERSION } from "../src/icons/data";
import { arcCubics, tabler, tablerLoaded } from "../src/icons";
import { resolveIcon, vendoredNodes } from "../src/render/icons";
import { toSvg } from "../src/dl/svg";
import { validate, type PathCmd, type PathNode } from "../src/dl/types";
import { decode64 } from "../src/text/hb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const script = fs.readFileSync(path.join(ROOT, "tools/vendor-tabler.mjs"), "utf8");

describe("Tabler data (ARCH-4)", () => {
  it("is registered for every core test (tests/setup-icons.ts) and inflated only when the first Tabler icon is drawn", () => {
    expect(fs.readFileSync(path.join(ROOT, "core/vitest.config.ts"), "utf8")).toContain('setupFiles: ["tests/setup-icons.ts"]');
    expect(fs.readFileSync(path.join(ROOT, "core/vitest.bench.config.ts"), "utf8")).toContain('setupFiles: ["tests/setup-icons.ts"]');
    expect(tablerLoaded()).toBe(false);
    expect(resolveIcon("target")).toMatchObject({ src: "builtin" });       // a built-in name does not inflate it
    expect(tablerLoaded()).toBe(false);
    const t0 = performance.now();
    expect(resolveIcon("tabler:arrow-up")).toMatchObject({ src: "tabler", name: "arrow-up", missing: false });
    console.log(`Tabler set inflated and indexed in ${(performance.now() - t0).toFixed(1)} ms`);
    expect(tablerLoaded()).toBe(true);
  });
  it("the inlined set inflates to the packed binary the vendor script pins (not data.ts's own constants); the header names the release's integrity", () => {
    const z = new Uint8Array(Buffer.from(TABLER, "base64")), raw = decode64(TABLER);
    // the independent copy: PACKED in tools/vendor-tabler.mjs, written by hand, checked by the script before it writes data.ts
    const packed = /export const PACKED = \{ bytes: (\d+), sha256: "([0-9a-f]{64})" \}/.exec(script)!;
    expect(packed[2]).toBe("982d079ac8be0f1208623bacd4a35cf186cf55a2d674110439c1867f38934573");
    expect(raw.length).toBe(Number(packed[1]));
    expect(sha(raw)).toBe(packed[2]);
    expect(TABLER_RAW_SHA256).toBe(packed[2]);
    // the deflated bytes as committed (zlib 1.3.1, level 9, of Node 22.22; another zlib build may deflate them differently,
    // which PACKED tolerates and this line does not: regenerate only with a reason, and update it then)
    expect(sha(z)).toBe("d692fcc9a51989bfb44ff561a08dae2c9ebc3834c3b938a050fcab3c4db496e3");
    expect(TABLER_SHA256).toBe(sha(z));
    expect(TABLER_VERSION).toBe("3.49.0");
    const head = fs.readFileSync(path.join(ROOT, "core/src/icons/data.ts"), "utf8").slice(0, 800);
    const integrity = /integrity: "(sha512-[^"]+)"/.exec(script)![1];
    expect(integrity).toBe("sha512-l+GnSkFETx0U26icxv1VUFnxxiTqXfCcVRiRAnyMwibupM2S2L/hSaZ9gmSgz01rkrsH/93NvLsxykqdanc6lw==");
    expect(head).toContain(`@tabler/icons@3.49.0 (MIT, see ./LICENSE-tabler; ${integrity})`);
    expect(head).toContain(`sha256 ${TABLER_SHA256}`);
    expect(fs.readFileSync(path.join(ROOT, "core/src/icons/LICENSE-tabler"), "utf8")).toMatch(/^MIT License\n\nCopyright \(c\) 2020-2026 Paweł Kuna/);
  });
  it("holds the release: 5,184 outline and 1,054 filled icons, 41 categories, tags, the alias table", () => {
    const t = tabler();
    expect(t.version).toBe("3.49.0");
    expect(t.grid).toBe(1000);
    expect(t.names.length).toBe(5184);
    expect(t.names.filter(n => t.has("outline", n)).length).toBe(5184);
    expect(t.names.filter(n => t.has("filled", n)).length).toBe(1054);
    expect(t.categories.length).toBe(41);
    expect(t.categories).toEqual(expect.arrayContaining(["Arrows", "Charts", "Currencies", "E-commerce", "Shapes", "System"]));
    expect(t.category("arrow-up")).toBe("Arrows");
    expect(t.tags("cash")).toEqual(expect.arrayContaining(["money", "payment", "currency"]));
    // old names: their own field, not tags; category, tags and oldNames resolve an old name as icon() does
    expect(t.oldNames("package")).toContain("box-seam");
    expect(t.tags("package")).not.toContain("box-seam");
    expect(t.category("box-seam")).toBe(t.category("package"));
    expect(t.tags("box-seam")).toEqual(t.tags("package"));
    expect(t.oldNames("box-seam")).toEqual(t.oldNames("package"));
    expect(t.category("no-such-icon")).toBeNull();
    expect(t.tags("no-such-icon")).toEqual([]);
    expect(t.oldNames("arrow-up")).toEqual([]);
    // the release's aliases (old name → new), per set
    expect(t.icon("outline", "box-seam")).toBe(t.icon("outline", "package"));
    expect(resolveIcon("tabler:box-seam")).toMatchObject({ src: "tabler", name: "box-seam", missing: false });
    expect(t.has("filled", "arrow-up")).toBe(false);
    expect(resolveIcon("tabler-filled:arrow-up")).toMatchObject({ src: "builtin", name: "arrow-up" });   // no filled arrow-up: the built-in
    expect(resolveIcon("tabler:no-such-icon")).toMatchObject({ src: "builtin", name: "info", missing: true });
    expect(resolveIcon("tabler:__proto__")).toMatchObject({ src: "builtin", name: "info", missing: true });
  });
});

describe("Tabler paths", () => {
  it("are Tabler's own: lines exact, arcs as cubics of at most 90° on the circle, Q as its cubic", () => {
    const t = tabler();
    expect(t.icon("outline", "arrow-up")!.map(p => p.d)).toEqual([[["M", 12, 5], ["L", 12, 19]], [["M", 18, 11], ["L", 12, 5]], [["M", 6, 11], ["L", 12, 5]]]);
    // "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0": two half circles, each two quarter cubics, every point on the radius-9 circle
    const [circle] = t.icon("outline", "circle")!;
    expect(circle.d.map(c => c[0])).toEqual(["M", "C", "C", "C", "C"]);
    let x = 3, y = 12;
    for (const c of circle.d.slice(1) as ["C", number, number, number, number, number, number][]) {
      const mid = [(x + 3 * c[1] + 3 * c[3] + c[5]) / 8, (y + 3 * c[2] + 3 * c[4] + c[6]) / 8];
      expect(Math.hypot(mid[0] - 12, mid[1] - 12)).toBeCloseTo(9, 2);
      expect(Math.hypot(c[5] - 12, c[6] - 12)).toBeCloseTo(9, 9);
      x = c[5]; y = c[6];
    }
    expect([x, y]).toEqual([3, 12]);
    // the filled star: absolute, its first point exact
    expect(t.icon("filled", "star")![0].d[0]).toEqual(["M", 8.243, 7.34]);
    expect(arcCubics(0, 0, 5, 5, 0, false, true, 10, 0)).toHaveLength(2);
    expect(arcCubics(0, 0, 0, 5, 0, false, true, 10, 0)).toEqual([["L", 10, 0]]);
    expect(arcCubics(1, 1, 5, 5, 0, false, true, 1, 1)).toEqual([]);
  });
  it("carry each path's paint: stroked, stroked and filled (dots), filled only (pies), half ink; filled icons filled", () => {
    const t = tabler();
    expect(t.icon("outline", "arrow-up")!.map(p => p.paint)).toEqual(Array(3).fill({ stroke: true, fill: false, alpha: 1 }));
    expect(t.icon("outline", "percentage-50")!.map(p => p.paint)).toEqual([{ stroke: false, fill: true, alpha: 1 }, { stroke: true, fill: false, alpha: 1 }]);
    expect(t.icon("outline", "accessible")!.some(p => p.paint.stroke && p.paint.fill)).toBe(true);
    expect(t.icon("outline", "brand-parsinta")!.map(p => p.paint.alpha)).toEqual([1, .5, 1]);
    for (const n of ["heart", "star", "home"]) for (const p of t.icon("filled", n)!) expect(p.paint).toEqual({ stroke: false, fill: true, alpha: 1 });
  });
});

describe("Tabler search index", () => {
  it("finds by name and tag, best first, within a set and a category", () => {
    const t = tabler(), names = (q: string, o = {}) => t.search(q, o).map(h => h.name);
    expect(names("arrow up")[0]).toBe("arrow-up");
    expect(names("arrow-up")[0]).toBe("arrow-up");
    expect(names("money")).toEqual(expect.arrayContaining(["cash", "coin"]));
    expect(names("money").indexOf("cash")).toBeLessThan(names("money").indexOf("chart-bar") >>> 0);
    expect(names("box-seam")).toContain("package");                             // an old name finds its icon
    expect(t.search("heart", { style: "filled" }).every(h => h.filled)).toBe(true);
    expect(t.search("", { category: "Currencies" }).length).toBeGreaterThan(20);
    expect(t.search("", { category: "Currencies" }).every(h => h.category === "Currencies")).toBe(true);
    expect(t.search("", { category: "No such" })).toEqual([]);
    expect(t.search("zzzqqq")).toEqual([]);
    expect(t.search("arrow", { limit: 120 })).toHaveLength(120);
    expect(t.search("").length).toBe(5184);
    const t0 = performance.now();
    for (const q of ["a", "ar", "arr", "arro", "arrow", "arrow u", "arrow up"]) t.search(q, { limit: 120 });
    console.log(`7 keystrokes searched in ${(performance.now() - t0).toFixed(1)} ms`);
  });
});

/** an icon's nodes in a 96 px box: valid, only M L C Z, finite, inside the box (strokes may reach half their width out) */
function drawn(style: "outline" | "filled", name: string, x = 100, y = 50, size = 96) {
  const r = resolveIcon(`${style === "outline" ? "tabler" : "tabler-filled"}:${name}`);
  if (r.src === "builtin") throw new Error(`${style} ${name} did not resolve`);
  const nodes = vendoredNodes(r, x, y, size / 24, [0x1f, 0x3a, 0x5f], 2);
  const err = validate(nodes, `${style}:${name}`);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) for (const c of n.d) {
    if (!["M", "L", "C", "Z"].includes(c[0])) err.push(`${name}: command ${c[0]}`);
    for (let k = 1; k < c.length; k += 2) {
      const px = c[k] as number, py = c[k + 1] as number;
      if (!Number.isFinite(px) || !Number.isFinite(py)) err.push(`${name}: not finite`);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    if (n.d[0][0] !== "M") err.push(`${name}: a path that does not start with M`);
  }
  const s = size / 24, pad = 2 * s;
  if (minX < x - pad || minY < y - pad || maxX > x + size + pad || maxY > y + size + pad) err.push(`${name}: outside its box ${[minX, minY, maxX, maxY]}`);
  // a stroked path's ink reaches its width beyond its points (wifi-0 is one 0.01-long segment: a round dot 2 wide)
  const ink = nodes.some(n => n.stroke) ? 2 * s : 0;
  if (maxX - minX + ink < s / 2 && maxY - minY + ink < s / 2) err.push(`${name}: draws nothing visible`);
  return { nodes, err };
}

describe("Tabler icons through the display list (IC-02, data part)", () => {
  it("a sample of both sets draws valid, finite path nodes inside its box, in SVG too", () => {
    const t = tabler(), errs: string[] = [];
    const pick = (style: "outline" | "filled") => t.names.filter(n => t.has(style, n)).filter((_, k) => k % 37 === 0);
    const sample = [...pick("outline").map(n => ["outline", n] as const), ...pick("filled").map(n => ["filled", n] as const),
      ["outline", "percentage-50"], ["outline", "brand-parsinta"], ["outline", "accessible"], ["outline", "circle"], ["filled", "circle"]] as const;
    expect(sample.length).toBeGreaterThan(150);
    const all: PathNode[] = [];
    for (const [style, name] of sample) { const { nodes, err } = drawn(style, name); errs.push(...err); all.push(...nodes); }
    expect(errs).toEqual([]);
    const svg = toSvg(all, { imageHref: () => undefined });
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg).toContain('stroke-linejoin="round"');
  });
  it("outline paths are stroked with round caps and joins, `stroke` wide at 24; filled ones filled; the ink's alpha halves", () => {
    const r = resolveIcon("tabler:brand-parsinta");
    if (r.src === "builtin") throw new Error("no brand-parsinta");
    const nodes = vendoredNodes(r, 0, 0, 2, [10, 20, 30], 1.5);
    expect(nodes[0].stroke).toEqual({ w: 3, paint: { solid: [10, 20, 30] }, cap: "round", join: "round" });
    expect(nodes[0].fill).toBeUndefined();
    expect(nodes[1].stroke!.paint).toEqual({ solid: [10, 20, 30], a: .5 });
    const f = resolveIcon("tabler-filled:heart");
    if (f.src === "builtin") throw new Error("no filled heart");
    const fn = vendoredNodes(f, 10, 10, 1, [1, 2, 3]);
    expect(fn.every(n => n.fill && !n.stroke && n.rule === undefined)).toBe(true);
    const sq: PathCmd[] = [["M", 0, 0], ["L", 24, 0], ["Z"]];
    expect(vendoredNodes({ src: "tabler", name: "x", asked: "tabler:x", missing: false, paths: [sq] }, 1, 2, .5, [0, 0, 0])[0])
      .toEqual({ t: "path", d: [["M", 1, 2], ["L", 13, 2], ["Z"]], stroke: { w: 1, paint: { solid: [0, 0, 0] }, cap: "round", join: "round" } });
  });
});

describe("every Tabler icon through the display list (TABLER_FULL=1; the S15.1 one-off check, repeatable)", () => {
  it.runIf(process.env.TABLER_FULL === "1")("all 5,184 outline and 1,054 filled icons resolve and draw valid, finite nodes inside their box, in SVG too", () => {
    const t = tabler(), errs: string[] = [];
    let count = 0, svgLen = 0;
    for (const style of ["outline", "filled"] as const) for (const name of t.names) {
      if (!t.has(style, name)) continue;
      const { nodes, err } = drawn(style, name);
      errs.push(...err); count++;
      const svg = toSvg(nodes, { imageHref: () => undefined });
      if (/NaN|undefined|Infinity/.test(svg)) errs.push(`${style}:${name}: SVG ${svg.slice(0, 80)}`);
      svgLen += svg.length;
    }
    for (const [from, style] of [["box-seam", "outline"]] as const) errs.push(...drawn(style, from).err);   // an old name too
    console.log(`TABLER_FULL: ${count} icons drawn, ${svgLen} bytes of SVG, ${errs.length} errors`);
    expect(errs).toEqual([]);
    expect(count).toBe(5184 + 1054);
  }, 120_000);
});

describe("only the workers carry the icon set", () => {
  it("no module but the worker entry and core/src/icons imports core/src/icons; the app never does", () => {
    const bad: string[] = [];
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
    for (const f of [...walk(path.join(ROOT, "core/src")), ...walk(path.join(ROOT, "app/src"))]) {
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");
      if (rel.startsWith("core/src/icons/") || rel === "core/src/workers/main.ts") continue;
      for (const m of fs.readFileSync(f, "utf8").matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
        const spec = m[1], to = spec.startsWith("@slide-builder/core/") ? path.join(ROOT, "core/src", spec.slice(20)) : spec.startsWith(".") ? path.resolve(path.dirname(f), spec) : null;
        if (to && /^core\/src\/icons(\/(index|data))?$/.test(path.relative(ROOT, to).replace(/\\/g, "/"))) bad.push(`${rel}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, "core/src/workers/main.ts"), "utf8")).toMatch(/import \{ installTabler \} from "\.\.\/icons";[\s\S]*installTabler\(\);/);
  });
});
