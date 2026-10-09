/* tools/parity.mjs: the comparison rules of the golden parity runner (PLAN S0.5, 05 §3.2). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolPath = path.join(here, "../../tools/parity.mjs");
const load = async () => (await import(/* @vite-ignore */ toolPath)) as any;

const img = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]) => {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(fill(x, y), (y * w + x) * 3);
  return { w, h, rgb };
};

function capture(dir: string, env: object, slide: object, extra: Record<string, unknown> = {}) {
  const d = path.join(dir, "deck", "glass", "full");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dir, "MANIFEST.json"), JSON.stringify({ decks: ["deck"], environment: env }));
  fs.writeFileSync(path.join(d, "slide-1.json"), JSON.stringify(slide));
  fs.writeFileSync(path.join(d, "comments.json"), JSON.stringify(extra.comments ?? []));
  fs.writeFileSync(path.join(d, "issues.json"), JSON.stringify(extra.issues ?? [{ slide: 1, text: "ok" }]));
  fs.writeFileSync(path.join(d, "pdf.json"), JSON.stringify(extra.pdf ?? { pages: 1, sizes: [[1200, 675]], fonts: ["F"], images: 0, text: [[{ s: "VUB", x: 10, y: 20 }]] }));
}
const slide = (over: Record<string, unknown> = {}) => ({ w: 1600, h: 900, items: [
  { cls: "title", x: 64, y: 40, w: 800, h: 50, text: "Loans", font: "Segoe UI", size: "40px", weight: "700", color: "rgb(0, 0, 0)" },
  { cls: "t", x: 100, y: 200, w: 60, h: 20, text: "1.234", font: "Segoe UI", size: "14px", weight: "400", color: "rgb(0, 0, 0)", ...over }] });

describe("parity", () => {
  it("PNG round trip and CIEDE2000 reference values (Sharma et al.)", async () => {
    const m = await load();
    const a = img(7, 5, (x, y) => [x * 30, y * 50, 99]);
    const b = m.decodePng(m.encodePng(a.w, a.h, a.rgb));
    expect([b.w, b.h]).toEqual([7, 5]);
    expect(Buffer.compare(a.rgb, b.rgb)).toBe(0);
    expect(m.deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(m.deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3);
    expect(m.deltaE2000([50, 2.5, 0], [50, 2.5, 0])).toBe(0);
  });
  it("pixels: identical and a 1 px edge shift pass; a changed block fails", async () => {
    const m = await load();
    const edge = (at: number) => img(40, 20, x => (x < at ? [255, 255, 255] : [0, 0, 0]));
    expect(m.comparePixels(edge(20), edge(20)).bad).toBe(0);
    expect(m.comparePixels(edge(20), edge(21)).bad).toBe(0);            // anti-aliasing tolerance
    const block = img(40, 20, (x, y) => (x > 5 && x < 15 && y > 5 && y < 15 ? [255, 0, 0] : [255, 255, 255]));
    const r = m.comparePixels(img(40, 20, () => [255, 255, 255]), block);
    expect(r.bad).toBeGreaterThan(50); expect(r.fraction).toBeGreaterThan(0.01);
    expect(m.comparePixels(edge(20), img(41, 20, () => [0, 0, 0])).size).toBe("40x20 vs 41x20");
  });
  it("texts exact, boxes ±2 px, accepted differences, text-only mode when the environment differs", async () => {
    const m = await load();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-parity-test-"));
    const env = { chromium: "141", fontsSha256: "abc" };
    try {
      const g = path.join(tmp, "g"), a = path.join(tmp, "a");
      capture(g, env, slide());
      capture(a, env, slide({ x: 101.5 }));                               // within 2 px
      expect(m.compare(g, a).diffs).toEqual([]);
      capture(a, env, slide({ x: 103, text: "1.235" }));
      let res = m.compare(g, a);
      expect(res.full).toBe(true);
      expect(res.diffs.map((d: any) => d.kind).sort()).toEqual(["geometry", "text"]);
      expect(res.unaccepted).toBe(2);
      // a listed difference is reported but accepted; an entry needs a kind, a scope, a reason and a sign-off
      res = m.compare(g, a, { accepted: [{ deck: "deck", kind: "geometry", reason: "B7", signedOff: "PO 2026-10-09" }] });
      expect(res.unaccepted).toBe(1);
      expect(() => m.compare(g, a, { accepted: [{ reason: "everything" }] })).toThrow(/needs kind/);
      // another Chromium or other fonts: geometry and size are not compared, colours and texts still are
      const other = { chromium: "153", fontsSha256: "zzz" };
      capture(a, other, slide({ x: 130, size: "15px" }));
      res = m.compare(g, a);
      expect(res.full).toBe(false);
      expect(res.diffs).toEqual([]);
      capture(a, other, slide({ color: "rgb(255, 0, 0)" }));
      expect(m.compare(g, a).diffs.map((d: any) => d.kind)).toEqual(["style"]);
      // comments and issues are texts; PDF text only with the same fonts (clipping and runs depend on them)
      const pdf = (s: string) => ({ pages: 1, sizes: [[1200, 675]], fonts: ["F"], images: 0, pageText: [s.replace(/\s/g, "")], text: [[{ s }]] });
      capture(g, env, slide(), { pdf: pdf("VUB") });
      capture(a, other, slide(), { issues: [{ slide: 1, text: "changed" }], pdf: pdf("PBZ") });
      expect(m.compare(g, a).diffs.map((d: any) => d.kind)).toEqual(["text"]);
      capture(a, env, slide(), { pdf: pdf("PBZ") });
      expect(m.compare(g, a).diffs.map((d: any) => d.kind)).toEqual(["pdf-text", "pdf-text"]);
      capture(a, env, slide(), { pdf: { ...pdf("VUB"), pages: 2 } });
      expect(m.compare(g, a).diffs.map((d: any) => d.kind)).toEqual(["pdf"]);
      expect(m.compare(g, a, { pdf: false }).diffs).toEqual([]);              // --no-pdf
      // a file the build no longer produces; a version the goldens do not have
      capture(a, env, slide(), { pdf: pdf("VUB") });
      fs.rmSync(path.join(a, "deck", "glass", "full", "comments.json"));
      expect(m.compare(g, a).diffs.some((d: any) => d.kind === "missing" && d.file === "comments.json")).toBe(true);
      fs.cpSync(path.join(a, "deck", "glass", "full"), path.join(a, "deck", "glass", "Board"), { recursive: true });
      expect(m.compare(g, a).diffs.some((d: any) => d.kind === "new" && d.version === "Board")).toBe(true);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});
