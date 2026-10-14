// @vitest-environment jsdom
/* The display list and its three backends (S3.1): validators, and every node type drawn by SVG, Canvas2D and the
   PDF writer. The PDF drawn by PDFium is compared with Chromium's canvas by tools/dlcheck.mjs (npm run sp). */
import fs from "node:fs";
import path from "node:path";
import { unzlibSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { drawDl, type Ctx } from "../src/dl/canvas";
import { radii, shadowLayers, spreadRadii } from "../src/dl/geom";
import { toSvg } from "../src/dl/svg";
import { NODE_TYPES, imageIds, validate, type DisplayList, type Node, type TextNode } from "../src/dl/types";
import { decodePng, jpegInfo } from "../src/pdf/png";
import { parseFont } from "../src/pdf/ttf";
import { writePdf, type PdfInput } from "../src/pdf/writer";
import { encodePng, nodeFixtures } from "./dl-fixtures";

const FIX = path.join(__dirname, "fixtures");
const read = (p: string) => new Uint8Array(fs.readFileSync(path.join(FIX, p)));
const fx = nodeFixtures({ carlito: read("fonts/Carlito-Regular.ttf"), carlitoBold: read("fonts/Carlito-Bold.ttf"), jpeg: read("images/wall-blur.jpg") });
const pdfInput = (pages: DisplayList[], extra: Partial<PdfInput> = {}): PdfInput => ({
  pages, image: id => fx.images.get(id), font: n => { const d = fx.fonts.get(`${n.font}|${n.b ? "b" : ""}`); return d && { key: `${n.font}|${n.b ? "b" : ""}`, data: d }; }, ...extra,
});
const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

/** the PDF's objects by number, each with its dictionary text and its (inflated) stream */
function parsePdf(bytes: Uint8Array) {
  const s = latin1(bytes), objs = new Map<number, { dict: string; stream?: Uint8Array }>();
  const sx = s.lastIndexOf("startxref"), xrefAt = parseInt(s.slice(sx + 10));
  expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
  const [, count] = /xref\n0 (\d+)\n/.exec(s.slice(xrefAt))!.map(Number);
  const rows = s.slice(xrefAt).split("\n").slice(2, 2 + count);
  for (let i = 1; i < count; i++) {
    const off = parseInt(rows[i].slice(0, 10));
    expect(s.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);       // every offset points at its object
    const end = s.indexOf("\nendobj", off), body = s.slice(off + `${i} 0 obj\n`.length, end);
    const st = body.indexOf("stream\n");
    if (st < 0) { objs.set(i, { dict: body }); continue; }
    const dict = body.slice(0, st), len = +/\/Length (\d+)/.exec(dict)![1], from = off + `${i} 0 obj\n`.length + st + 7;
    let data: Uint8Array = bytes.slice(from, from + len);
    if (dict.includes("/FlateDecode")) data = unzlibSync(data);
    objs.set(i, { dict, stream: data });
  }
  return { text: s, objs, all: [...objs.values()] };
}

describe("display list validators", () => {
  it("accepts every fixture", () => {
    for (const [k, list] of Object.entries(fx.lists)) expect(validate(list), k).toEqual([]);
  });
  it("there is a fixture for each of the 8 node types", () => {
    const seen = new Set<string>();
    const walk = (l: DisplayList) => l.forEach(n => { seen.add(n.t); if (n.t === "group") walk(n.children); });
    Object.values(fx.lists).forEach(walk);
    expect([...seen].sort()).toEqual([...NODE_TYPES].sort());
    expect(Object.keys(fx.lists).sort()).toEqual([...NODE_TYPES].sort());
  });
  it("names what is wrong", () => {
    const bad = [
      { t: "rect", x: 0, y: 0, w: -1, h: 5 },
      { t: "rect", x: 0, y: 0, w: 1, h: 1, fill: { solid: [0, 0, 300] } },
      { t: "rect", x: 0, y: 0, w: 1, h: 1, fill: { linear: [0, 0, 1], stops: [] } },
      { t: "rect", x: 0, y: 0, w: 1, h: 1, fill: { radial: { cx: 0, cy: 0, rx: 0, ry: 1, stops: [{ o: 0, c: [0, 0, 0], a: 1 }] } } },
      { t: "path", d: [["L", 1, 1]], stroke: { w: 1, paint: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: [0, 0, 0], a: 1 }] } } },
      { t: "line", x1: 0, y1: 0, x2: 1, y2: NaN, stroke: { w: 0, paint: { solid: [0, 0, 0] } } },
      { t: "image", id: "", x: 0, y: 0, w: 1, h: 1, crop: { l: .6, t: 0, r: .5, b: 0 } },
      { t: "shadow", x: 0, y: 0, w: 1, h: 1, dx: 0, dy: 0, blur: -1, spread: 0, c: [0, 0, 0], a: 2 },
      { t: "text", font: "", size: 0, x: 0, y: 0, src: "a", fill: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: [0, 0, 0], a: 1 }] }, gids: [1], adv: [] },
      { t: "text", font: "F", size: 9, x: 0, y: 0, src: "a", fill: { solid: [0, 0, 0] }, decoration: { underline: true } },
      { t: "group", blend: "screen", transform: [1, 0, 0], children: [{ t: "ellipse" }] },
      { t: "hit", kind: 1, id: "x", x: 0, y: 0, w: 1, h: 1 },
      { t: "rect", x: 0, y: 0, w: 1, h: 1 },
    ];
    const errs = validate(bad);
    for (const want of ["[0]:rect.w: < 0", "[1]:rect.fill.solid: bad colour", "[2]:rect.fill.linear: 4 numbers", "[2]:rect.fill.stops: no stops",
      "[3]:rect.fill.radial", "[4]:path.d[0]: must start with M", "[4]:path.stroke: a gradient stroke only on rect and line", "[5]:line.y2", "[5]:line.stroke.w",
      "[6]:image.id: empty", "[6]:image.crop", "[7]:shadow.blur: < 0", "[7]:shadow.a", "[8]:text.font", "[8]:text.size", "[8]:text.fill: text is solid", "[8]:text: gids and adv",
      "[9]:text.decoration: needs w", "[10]:group.blend", "[10]:group.transform", "[10]:group.children[0]: unknown node", "[11]:hit: kind, id", "[12]:rect: neither fill nor stroke"])
      expect(errs.some(e => e.includes(want)), `${want} in\n${errs.join("\n")}`).toBe(true);
    expect(validate({})).toEqual(["dl: not an array"]);
  });
  it("lists the pictures a list draws", () => {
    expect([...imageIds(fx.lists.image)].sort()).toEqual(["checker", "jpg", "jpg-copy", "missing", "ring", "ring-shadow"]);
    expect([...imageIds(fx.lists.group)].sort()).toEqual(["checker", "jpg"]);
  });
  it("display lists are plain data (structured clone, JSON)", () => {
    for (const l of Object.values(fx.lists)) { expect(structuredClone(l)).toEqual(l); expect(JSON.parse(JSON.stringify(l))).toEqual(l); }
  });
});

describe("shared geometry", () => {
  it("scales overlapping radii down together (CSS)", () => {
    expect(radii(100, 120, 60)).toEqual([30, 30, 30, 30]);
    expect(radii([10, 20, 30, 40], 200, 200)).toEqual([10, 20, 30, 40]);
    expect(radii(undefined, 5, 5)).toEqual([0, 0, 0, 0]);
  });
  it("spreads radii as box-shadow does", () => {
    expect(spreadRadii([0, 10, 28, 2], 6)).toEqual([0, 16, 34, 2 + 6 * (1 + (2 / 6 - 1) ** 3)]);
    expect(spreadRadii([28, 28, 10, 0], -24)).toEqual([4, 4, 0, 0]);
  });
  it("a soft shadow is 5 sharp layers of a/5, reaching ±60 % of the blur; a sharp one is 1 layer", () => {
    const n = { t: "shadow" as const, x: 0, y: 0, w: 100, h: 100, r: 10, dx: 0, dy: 22, blur: 48, spread: -24, c: [0, 0, 0] as [number, number, number], a: .5 };
    const l = shadowLayers(n);
    expect(l).toHaveLength(5);
    expect(l.every(x => Math.abs(x.a - .1) < 1e-9)).toBe(true);
    // v3: spread + blur·.6·((k+1)/5 − .5) → −32.64, −26.88, −21.12, −15.36, −9.6; a layer starts at x = −s + its radius (max(0, 10 + s))
    expect(l.map(x => (x.fill[0] as number[])[1])).toEqual([32.64, 26.88, 21.12, 15.36, 9.6 + .4].map(v => expect.closeTo(v, 6)));
    expect(shadowLayers({ ...n, h: 50 })).toHaveLength(3);              // layers shrunk to nothing (h + 2s ≤ 0) are not drawn
    expect(shadowLayers({ ...n, blur: 0, spread: 3 })).toHaveLength(1);
    expect(shadowLayers({ ...n, spread: -80 })).toHaveLength(0);       // shrunk to nothing: nothing drawn
  });
});

describe("SVG backend", () => {
  const svg = (l: DisplayList) => toSvg(l, { imageHref: id => fx.images.has(id) ? `data:image/x;base64,${id}` : undefined, hits: true });
  it("draws every node type", () => {
    const s = Object.fromEntries(Object.entries(fx.lists).map(([k, l]) => [k, svg(l)]));
    for (const v of Object.values(s)) expect(v).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 1600 900"/);
    expect(s.rect).toContain("<linearGradient");
    expect(s.rect).toContain("<radialGradient");
    expect(s.rect).toContain(`stroke-dasharray="12 6"`);
    expect(s.rect).toMatch(/fill-rule="evenodd" fill="url\(#d\d+\)"/);          // the gradient rim as a ring
    expect(s.path).toContain(`fill-rule="evenodd"`);
    expect(s.path).toContain(`stroke-linecap="round"`);
    expect(s.line).toContain(`stroke-width="0.5"`);
    expect(s.line).toContain(`stroke-dasharray="9 3 3 3"`);
    expect(s.image).toContain(`opacity="0.5"`);
    expect(s.image).toContain(`href="data:image/x;base64,ring-shadow"`);
    expect(s.image).not.toContain("missing");
    expect(s.image).toMatch(/<g transform="matrix\(/);
    expect(s.shadow.match(/fill-opacity="0.11"/g)).toHaveLength(5);              // .55 / 5
    expect(s.shadow).toContain(`clip-rule="evenodd"`);
    expect(s.text).toContain(`lengthAdjust="spacing"`);                              // the run with a measured width only
    expect(s.text).toMatch(/<text x="80 \d+(\.\d+)? \d+(\.\d+)?/);                    // a shaped run: one x per character
    expect(s.text).toContain(`font-weight="700"`);
    expect(s.text).toContain(`xml:space="preserve"`);
    expect(s.text).toContain("Δ vs. Budget");
    expect(s.group).toContain(`opacity="0.5"`);
    expect(s.group).toContain("mix-blend-mode:multiply");
    expect(s.group).toContain("clip-path=");
    expect(s.hit).toContain(`data-hit="cell" data-id="Sheet1!B2"`);
    expect(toSvg(fx.lists.hit, { imageHref: () => undefined })).not.toContain("data-hit");
  });
  it("is well-formed XML, with each gradient and clip defined once", () => {
    for (const [k, l] of Object.entries(fx.lists)) {
      const s = svg(l), doc = new DOMParser().parseFromString(s, "image/svg+xml");
      expect(doc.getElementsByTagName("parsererror").length, k).toBe(0);
      const ids = [...s.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
      expect(new Set(ids).size, k).toBe(ids.length);
      for (const m of s.matchAll(/url\(#([^)]+)\)/g)) expect(ids, k).toContain(m[1]);
    }
  });
  it("escapes text and attributes", () => {
    const s = svg([{ t: "text", font: `A"b`, size: 10, x: 0, y: 0, src: `<&> "q"`, fill: { solid: [0, 0, 0] } }]);
    expect(s).toContain("&lt;&amp;&gt; \"q\"");
    expect(s).toContain(`font-family="'A&quot;b'"`);
  });
  it("the stage's hits (S4.1): chosen per hit, with a class and the label as a <desc>; the others left out", () => {
    const list: DisplayList = [{ t: "hit", kind: "t", id: "5,3", x: 1, y: 2, w: 30, h: 10, label: "R&D <1>" }, { t: "hit", kind: "f", id: "title", x: 0, y: 0, w: 9, h: 9, label: "x" }];
    const s = toSvg(list, { imageHref: () => undefined, hits: n => n.kind === "t" ? { cls: "t", label: true } : null });
    expect(s).toContain(`<rect x="1" y="2" width="30" height="10" fill="transparent" class="t" data-hit="t" data-id="5,3"><desc>R&amp;D &lt;1&gt;</desc></rect>`);
    expect(s).not.toContain(`data-id="title"`);
    expect(new DOMParser().parseFromString(s, "image/svg+xml").getElementsByTagName("parsererror").length).toBe(0);
  });
  it("fewer nodes, the same pixels (S4.1): a clip that cannot cut its text is left out; clips are defined once", () => {
    const run = (x: number, w: number): DisplayList[number] => ({ t: "text", font: "Arial", size: 12, x, y: 30, src: "12,5", w, fill: { solid: [0, 0, 0] } });
    const cell = (x: number, w: number): DisplayList[number] => ({ t: "group", clip: { x: 0, y: 10, w: 100, h: 30 }, children: [run(x, w)] });
    expect(toSvg([cell(10, 40)], { imageHref: () => undefined })).not.toContain("clip-path");          // fits: nothing to cut
    expect(toSvg([cell(70, 40)], { imageHref: () => undefined })).toContain("clip-path");              // runs past the cell
    expect(toSvg([{ ...cell(10, 40), clip: { x: 0, y: 10, w: 100, h: 30, r: 4 } } as DisplayList[number]], { imageHref: () => undefined })).toContain("clip-path");
    const two = toSvg([cell(70, 40), cell(80, 40)], { imageHref: () => undefined });
    expect(two.match(/<clipPath /g)).toHaveLength(1);                                               // one outline, one clip
    expect(two.match(/clip-path="url\(#d0\)"/g)).toHaveLength(2);
    // a stepped shadow: its 5 layers under one clip
    const sh = toSvg([{ t: "shadow", x: 100, y: 100, w: 200, h: 80, r: 12, dx: 0, dy: 8, blur: 24, spread: -4, c: [10, 20, 40], a: .3 }], { imageHref: () => undefined });
    expect(sh.match(/<clipPath /g)).toHaveLength(1); expect(sh.match(/<path d=/g)).toHaveLength(6);
    // rects with the same gradient (a table's capsules): one def in their own box's units, the mapping of the user-space one
    const paint = { linear: [0, 0, 0, 1] as [number, number, number, number], stops: [{ o: 0, c: [255, 0, 0] as [number, number, number], a: .9 }, { o: 1, c: [200, 0, 0] as [number, number, number], a: .4 }] };
    const caps = toSvg([{ t: "rect", x: 10, y: 10, w: 60, h: 14, r: 7, fill: paint }, { t: "rect", x: 90, y: 30, w: 50, h: 14, r: 7, fill: paint }], { imageHref: () => undefined });
    expect(caps.match(/<linearGradient /g)).toHaveLength(1);
    expect(caps).toContain(`gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">`);
    expect(caps.match(/fill="url\(#d0\)"/g)).toHaveLength(2);
    // a gradient ring (its outline larger than the box): user space, mapped onto the box
    expect(toSvg([{ t: "rect", x: 10, y: 10, w: 60, h: 14, stroke: { w: 2, paint } }], { imageHref: () => undefined })).toContain(`gradientUnits="userSpaceOnUse"`);
  });
  it("soft shadows (B3): one blurred shape per shadow – standard deviation blur / 2, as CSS – instead of the 5 layers", () => {
    const outer: DisplayList = [{ t: "shadow", x: 100, y: 100, w: 200, h: 80, r: 12, dx: 0, dy: 8, blur: 24, spread: -4, c: [10, 20, 40], a: .3 }];
    const inset: DisplayList = [{ ...outer[0], inset: true } as DisplayList[number]];
    for (const l of [outer, inset]) {
      const s = toSvg(l, { imageHref: () => undefined, softShadows: true });
      expect(s.match(/<feGaussianBlur stdDeviation="12"\/>/g)).toHaveLength(1);
      expect(s.match(/fill-opacity="0.3"/g)).toHaveLength(1);                    // the whole strength, once
      expect(s).toContain(`clip-rule="evenodd"`);
      expect(new DOMParser().parseFromString(s, "image/svg+xml").getElementsByTagName("parsererror").length).toBe(0);
    }
    // the filter region holds the blurred shape (3 standard deviations past the grown box)
    const m = /<filter id="[^"]+" filterUnits="userSpaceOnUse" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/.exec(toSvg(outer, { imageHref: () => undefined, softShadows: true }))!;
    expect(+m[1]).toBeLessThanOrEqual(100 + 4 - 36); expect(+m[3]).toBeGreaterThanOrEqual(200 - 8 + 72);
    // without it, or a sharp shadow: the PDF's layers
    expect(toSvg(outer, { imageHref: () => undefined }).match(/fill-opacity="0.06"/g)).toHaveLength(5);
    expect(toSvg([{ ...outer[0], blur: 0 } as DisplayList[number]], { imageHref: () => undefined, softShadows: true })).not.toContain("feGaussianBlur");
  });
});

/** a 2D context that records what it is asked to do */
function recorder() {
  const calls: string[] = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const grad = () => ({ addColorStop: (o: number, c: string) => calls.push(`stop ${o} ${c}`) });
  const target: Record<string, unknown> = {
    canvas: { width: 1600, height: 900 },
    measureText: (s: string) => ({ width: s.length * 10 }),
    getTransform: () => transform, setTransform: (...m: number[]) => { transform = m.length === 6 ? m : transform; calls.push(`setTransform ${m.length}`); },
    createLinearGradient: (...a: number[]) => { calls.push(`linear ${a.join(",")}`); return grad(); },
    createRadialGradient: (...a: number[]) => { calls.push(`radial ${a.join(",")}`); return grad(); },
  };
  const ctx = new Proxy(target, {
    get(t, k: string) { if (k in t) return t[k]; return (...a: unknown[]) => { calls.push(`${k}${a.length ? " " + a.map(v => typeof v === "object" ? "obj" : String(v)).join(",") : ""}`); }; },
    set(t, k: string, v) { t[k] = v; calls.push(`${k}=${typeof v === "object" ? "obj" : v}`); return true; },
  });
  (ctx as Record<string, unknown>).letterSpacing = "0px";
  (ctx as Record<string, unknown>).globalAlpha = 1;
  calls.length = 0;
  return { ctx: ctx as unknown as Ctx, calls };
}

describe("Canvas2D backend", () => {
  const draw = (l: DisplayList, layer = true) => {
    const r = recorder(), layers: ReturnType<typeof recorder>[] = [];
    drawDl(r.ctx, l, { image: id => fx.images.has(id) ? ({ id } as unknown as CanvasImageSource) : undefined, layer: layer ? () => { const x = recorder(); layers.push(x); return { ctx: x.ctx, image: {} as CanvasImageSource }; } : undefined });
    return { calls: r.calls, layers };
  };
  it("draws every node type", () => {
    const c = Object.fromEntries(Object.entries(fx.lists).map(([k, l]) => [k, draw(l).calls]));
    const has = (k: string, s: string | RegExp) => expect(c[k].some(x => typeof s === "string" ? x.startsWith(s) : s.test(x)), `${k}: ${s}`).toBe(true);
    has("rect", "linear 0,0,1,1"); has("rect", "radial 0,0,0,0,0,1"); has("rect", "setLineDash obj"); has("rect", "fill evenodd"); has("rect", "stop 0.5 rgba(234,179,8,1)");
    has("path", "bezierCurveTo"); has("path", "lineCap=round"); has("path", "fill evenodd");
    has("line", "lineWidth=0.5"); has("line", "stroke");
    has("image", "drawImage obj,"); has("image", "globalAlpha=0.5"); has("image", "clip"); has("image", /^transform /);
    expect(c.image.filter(x => x.startsWith("drawImage")).length).toBe(8);         // 7 pictures + 1 shadow; the missing one is left out
    expect(c.shadow.filter(x => x === "clip evenodd").length).toBe(5 + 1 + 5 + 5 + 5);
    has("text", "fillText L,80,120"); has("text", "fillText Δ,"); has("text", /^font=700 48px 'Carlito'/); has("text", "fillText minimum 1100,900,120"); has("text", /^letterSpacing=/); has("text", "fillRect");
    expect(c.text).not.toContain("fillText  ,");                                     // spaces of a shaped run are not drawn
    has("group", "clip"); has("group", /^transform 1.12,0,0,1.12/);
    expect(c.hit.filter(x => x.startsWith("fill "))).toHaveLength(2);              // only the rect: hit nodes draw nothing
  });
  it("composites a group with alpha or a blend mode once, from a layer", () => {
    const { calls, layers } = draw(fx.lists.group);
    expect(layers).toHaveLength(2);
    expect(calls).toContain("globalAlpha=0.5");
    expect(calls).toContain("globalCompositeOperation=multiply");
    expect(layers[0].calls.filter(x => x.startsWith("fill ")).length).toBe(2);       // both overlapping rects in the layer
    const noLayer = draw(fx.lists.group, false);
    expect(noLayer.layers).toHaveLength(0);
    expect(noLayer.calls).toContain("globalAlpha=0.5");
  });
  it("puts a horizontal run's baseline on a whole device pixel (floored); its start on one (rounded) only where the list scales it", () => {
    // getTransform: the first call is drawDl's start (a device scale of 1.5), later ones what the text is drawn under
    const run = (inner: number) => {
      const calls: string[] = []; let n = 0;
      const ctx = new Proxy({ getTransform: () => (n++ ? { a: inner, b: 0, c: 0, d: inner, e: 10.3, f: 20.2 } : { a: 1.5, b: 0, c: 0, d: 1.5, e: 0, f: 0 }), measureText: () => ({ width: 10 }) } as Record<string, unknown>, {
        get(t, k: string) { if (k in t) return t[k]; return (...a: unknown[]) => { calls.push(`${k} ${a.join(",")}`); }; }, set() { return true; } });
      drawDl(ctx as unknown as Ctx, [{ t: "text", font: "F", size: 10, x: 4.1, y: 7.7, src: "ab", fill: { solid: [0, 0, 0] } }], { image: () => undefined });
      return calls.find(c => c.startsWith("fillText"))!.split(" ")[1].split(",").map(Number).slice(1);
    };
    // only the device scale: the start keeps its fraction (Chromium's subpixel positioning of unscaled text)
    const [x1, y1] = run(1.5);
    expect(1.5 * y1 + 20.2).toBeCloseTo(Math.floor(1.5 * 7.7 + 20.2), 6);
    expect(x1).toBeCloseTo(4.1, 6);
    // a table scaled by the list (×0.8 on the device's 1.5): the start on a whole device pixel too
    const [x2, y2] = run(1.2);
    expect(1.2 * y2 + 20.2).toBeCloseTo(Math.floor(1.2 * 7.7 + 20.2), 6);
    expect(1.2 * x2 + 10.3).toBeCloseTo(Math.round(1.2 * 4.1 + 10.3), 6);
  });
  it("pins a run to its measured width with letterSpacing", () => {
    const { calls } = draw([{ t: "text", font: "F", size: 10, x: 0, y: 0, src: "abcd", w: 48, fill: { solid: [0, 0, 0] } }]);
    expect(calls).toContain(`letterSpacing=${8 / 3}px`);                             // (48 − 4·10) / 3 gaps: the last ends at x + w
  });
});

describe("PDF writer", () => {
  const all = Object.values(fx.lists);
  it("writes every node type as a valid PDF: one page each, 1200 × 675 with the slide mapped by cm", () => {
    for (const [k, l] of Object.entries(fx.lists)) {
      const pdf = parsePdf(writePdf(pdfInput([l], { compress: false })));
      expect(pdf.text.startsWith("%PDF-1.7\n"), k).toBe(true);
      expect(pdf.text, k).toContain("/MediaBox[0 0 1200 675]");
      expect(pdf.text, k).not.toContain("/ObjStm");
      const content = pdf.all.find(o => o.stream && latin1(o.stream).startsWith("0.75 0 0 -0.75 0 675 cm"));
      expect(content, k).toBeTruthy();
    }
  });
  it("draws each node with the operators it needs", () => {
    const page = (l: DisplayList) => {
      const pdf = parsePdf(writePdf(pdfInput([l], { compress: false })));
      return { pdf, ops: pdf.all.filter(o => o.stream && !o.dict.includes("/Image") && !o.dict.includes("/Length1")).map(o => latin1(o.stream!)).join("\n") };
    };
    const r = page(fx.lists.rect);
    expect(r.ops).toMatch(/ 300 160 re f Q/);
    expect(r.ops).toMatch(/ c .* h f Q/);
    expect(r.ops).toMatch(/W n [\d. -]+ cm \/G\d+ gs \/S\d+ sh Q/);                     // tint with a soft mask
    expect(r.ops).toMatch(/W n [\d. -]+ cm \/G\d+ gs [\d. -]+ cm \/S\d+ sh Q/);         // elliptical radial: its own matrix
    expect(r.ops).toContain("[12 6] 0 d");
    expect(r.ops).toMatch(/W\* n .* sh Q/);                                              // the gradient rim (a ring)
    expect(r.pdf.text).toContain("/ShadingType 3");
    expect(r.pdf.text).toContain("/SMask<</S/Luminosity");
    const p = page(fx.lists.path);
    expect(p.ops).toContain("f* Q");
    expect(p.ops).toContain("1 J");
    const ln = page(fx.lists.line);
    expect(ln.ops).toContain("0.5 w");
    expect(ln.ops).toContain("[9 3 3 3] 0 d");
    const im = page(fx.lists.image);
    expect(im.ops.match(/ Do Q/g)!.length).toBeGreaterThanOrEqual(6);
    expect(im.pdf.text).toContain("/Filter/DCTDecode");
    expect(im.pdf.text).toMatch(/\/SMask \d+ 0 R/);                                        // the PNG's alpha
    const sh = page(fx.lists.shadow);
    expect(sh.ops.match(/W\* n \/G\d+ gs/g)).toHaveLength(5 + 1 + 5 + 5 + 5);
    const tx = page(fx.lists.text);
    expect(tx.ops).toMatch(/BT \/F\d+ 32 Tf 1 0 0 -1 80 120 Tm/);
    expect(tx.ops).toMatch(/ Tc </);                                                       // pinned to the measured width
    expect(tx.ops).toMatch(/\] TJ ET/);                                                    // the shaped run: kerning as TJ adjustments
    expect(tx.pdf.text).toContain("/Subtype/CIDFontType2");
    expect(tx.pdf.text).toContain("/FontFile2");
    expect(tx.pdf.text).toMatch(/\/BaseFont\/[A-Z]{6}\+Carlito-Regular\//);
    const g = page(fx.lists.group);
    expect(g.pdf.text).toContain("/Group<</S/Transparency/I true/CS/DeviceRGB>>");
    expect(g.pdf.text).toContain("/BM/Multiply");
    expect(g.ops).toMatch(/\/X\d+ Do Q/);
    const h = page(fx.lists.hit);
    expect(h.ops.match(/ f Q/g)).toHaveLength(2);
  });
  it("shares pictures by content and gradients by style across pages", () => {
    const pdf = parsePdf(writePdf(pdfInput([fx.lists.image, fx.lists.image, fx.lists.group])));
    const one = parsePdf(writePdf(pdfInput([fx.lists.rect])));
    const images = pdf.all.filter(o => o.dict.includes("/Subtype/Image") && !o.dict.includes("/DeviceGray"));
    expect(images).toHaveLength(4);                                                        // jpg (= jpg-copy), ring, its shadow, checker
    expect(pdf.all.filter(o => o.dict.includes("/Subtype/Image") && o.dict.includes("/DeviceGray"))).toHaveLength(2);   // the ring's and the shadow's alpha
    // the same rect page twice adds no shading, no mask and no graphic state
    const twice = parsePdf(writePdf(pdfInput([fx.lists.rect, fx.lists.rect])));
    for (const kind of ["/ShadingType", "/Type/ExtGState", "/S/Luminosity"]) expect(twice.all.filter(o => o.dict.includes(kind)).length, kind).toBe(one.all.filter(o => o.dict.includes(kind)).length);
    // 100 capsules with one gradient style: one shading and one soft mask
    const caps: Node[] = Array.from({ length: 100 }, (_, i) => ({ t: "rect", x: 10 + (i % 10) * 150, y: 10 + Math.floor(i / 10) * 80, w: 40 + i, h: 30, r: 15, fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: [255, 255, 255], a: .6 }, { o: 1, c: [255, 255, 255], a: .1 }] } }));
    const c = parsePdf(writePdf(pdfInput([caps])));
    expect(c.all.filter(o => o.dict.includes("/ShadingType"))).toHaveLength(2);           // colour + its grey mask
    expect(c.all.filter(o => o.dict.includes("/S/Luminosity"))).toHaveLength(1);
  });
  it("subsets fonts per document: one font per face, the used glyphs only, with widths and ToUnicode", () => {
    const pdf = parsePdf(writePdf(pdfInput([fx.lists.text, fx.lists.group])));
    const type0 = pdf.all.filter(o => o.dict.includes("/Subtype/Type0"));
    expect(type0).toHaveLength(2);                                                        // Carlito and Carlito Bold
    const file = pdf.all.find(o => o.dict.includes("/Length1"))!;
    expect(file.stream!.length).toBeLessThan(read("fonts/Carlito-Regular.ttf").length / 3);
    const tu = pdf.all.map(o => o.stream && latin1(o.stream)).filter(s => s?.includes("beginbfchar")).join("\n");
    expect(tu).toContain("<0394>");                                                       // Δ maps back to its code point
    const w = pdf.all.find(o => o.dict.includes("/CIDFontType2"))!.dict;
    expect(w).toMatch(/\/W\[\d+\[\d+/);
    expect(pdf.text).not.toContain("/Type3");
  });
  it("refuses a missing font and a picture it cannot read, and leaves out a missing picture", () => {
    expect(() => writePdf(pdfInput([[{ t: "text", font: "Nope", size: 9, x: 0, y: 0, src: "a", fill: { solid: [0, 0, 0] } }]]))).toThrow(/no font file for Nope/);
    expect(() => writePdf({ ...pdfInput([[{ t: "image", id: "x", x: 0, y: 0, w: 1, h: 1 }]]), image: () => new Uint8Array([1, 2, 3]) })).toThrow(/not a JPEG or PNG/);
    const pdf = parsePdf(writePdf(pdfInput([[{ t: "image", id: "missing", x: 0, y: 0, w: 1, h: 1 }]])));
    expect(pdf.all.filter(o => o.dict.includes("/Subtype/Image"))).toHaveLength(0);
  });
  it("refuses a font whose licence forbids embedding", () => {
    const d = read("fonts/Carlito-Regular.ttf").slice(), dv = new DataView(d.buffer);
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) if (latin1(d.subarray(12 + 16 * i, 16 + 16 * i)) === "OS/2") dv.setUint16(dv.getUint32(12 + 16 * i + 8) + 8, 2);
    expect(() => writePdf({ ...pdfInput([fx.lists.text]), font: () => ({ key: "r", data: d }) })).toThrow(/does not allow embedding/);
  });
  it("is deterministic and small", () => {
    const a = writePdf(pdfInput(all)), b = writePdf(pdfInput(all));
    expect(a).toEqual(b);
    expect(a.length).toBeLessThan(200_000);
  });
  it("writes the title as a PDF string", () => {
    expect(latin1(writePdf(pdfInput([fx.lists.hit], { title: "Weekly (2) é" })))).toContain("/Title<FEFF");
    expect(latin1(writePdf(pdfInput([fx.lists.hit], { title: "Weekly (2)" })))).toContain("/Title(Weekly \\(2\\))");
  });
});

describe("review fixes (S3.1)", () => {
  const ops = (bytes: Uint8Array) => parsePdf(bytes).all.filter(o => o.stream && !o.dict.includes("/Image") && !o.dict.includes("/Length1")).map(o => latin1(o.stream!)).join("\n");
  const one = (n: Node, extra: Partial<PdfInput> = {}) => writePdf(pdfInput([[n]], { compress: false, ...extra }));
  it("a soft mask covers a ring that reaches outside its box", () => {
    const pdf = latin1(one({ t: "rect", x: 0, y: 0, w: 300, h: 2, stroke: { w: 20, paint: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: [0, 0, 0], a: 1 }, { o: 1, c: [0, 0, 0], a: .1 }] } } }));
    const bbox = /\/BBox\[([-\d. ]+)\]\/Group<<\/S\/Transparency\/CS\/DeviceGray/.exec(pdf)![1].split(" ").map(Number);
    expect(bbox[1]).toBeLessThanOrEqual(-5);                  // 10 px above a 2 px box = −5 box heights
    expect(bbox[3]).toBeGreaterThanOrEqual(6);
  });
  it("a linear paint without a direction is its last stop in all three backends", () => {
    const n: Node = { t: "rect", x: 0, y: 0, w: 10, h: 10, fill: { linear: [0, 0, 0, 0], stops: [{ o: 0, c: [255, 0, 0], a: 1 }, { o: 1, c: [0, 0, 255], a: 1 }] } };
    expect(toSvg([n], { imageHref: () => undefined })).toContain(`fill="rgb(0,0,255)"`);
    const r = recorder(); drawDl(r.ctx, [n], { image: () => undefined });
    expect(r.calls).toContain("fillStyle=rgba(0,0,255,1)");
    expect(ops(one(n))).toContain("0 0 1 rg");
  });
  it("strokes join with miters up to 10 in all three backends", () => {
    const n: Node = { t: "path", d: [["M", 0, 0], ["L", 50, 10], ["L", 100, 0]], stroke: { w: 4, paint: { solid: [0, 0, 0] } } };
    expect(toSvg([n], { imageHref: () => undefined })).toContain(`stroke-miterlimit="10"`);
    const r = recorder(); drawDl(r.ctx, [n], { image: () => undefined });
    expect(r.calls).toEqual(expect.arrayContaining(["lineJoin=miter", "miterLimit=10"]));
    expect(ops(one(n))).toContain("0 j 10 M");
  });
  it("places glyphs with the widths it writes: W with decimals, TJ / Tc from the same widths", () => {
    const t = fx.lists.text.find(n => n.t === "text" && n.src.startsWith("Loans")) as TextNode;
    const pdf = parsePdf(one(t)), f = parseFont(read("fonts/Carlito-Regular.ttf"), "c");
    const w = new Map<number, number>();
    for (const m of pdf.all.find(o => o.dict.includes("/CIDFontType2"))!.dict.matchAll(/(\d+)\[([\d. ]+)\]/g)) m[2].split(" ").forEach((v, i) => w.set(+m[1] + i, +v));
    expect([...w.values()].some(v => !Number.isInteger(v))).toBe(true);
    // replay the TJ: every glyph's origin as a viewer computes it equals the display list's within 0.01 px
    const tj = /\[(.*)\] TJ/.exec(ops(one(t)))![1];
    let x = t.x, i = 0; const origins: number[] = [];
    for (const m of tj.matchAll(/<([0-9a-f]+)>|(-?[\d.]+)/g)) {
      if (m[1]) for (let k = 0; k < m[1].length; k += 4) { const g = parseInt(m[1].slice(k, k + 4), 16); origins.push(x); x += w.get(g)! * t.size / 1000; i++; }
      else x -= +m[2] * t.size / 1000;
    }
    let want = t.x; t.adv!.forEach((a, k) => { expect(Math.abs(origins[k] - want)).toBeLessThan(.01); want += a; });
    expect(f.unitsPerEm).toBe(2048);
    // a measured width only: Tc spreads it over the gaps (n − 1)
    const m = fx.lists.text.find(n => n.t === "text" && n.src === "minimum 1100") as TextNode;
    const tc = +/([-\d.]+) Tc/.exec(ops(one(m)))![1];
    const natural = [...m.src].reduce((s, ch) => s + Math.round(f.advances[f.cmap.get(ch.codePointAt(0)!)!] * 1000 / 2048 * 100) / 100 * m.size / 1000, 0);
    expect(tc).toBeCloseTo((m.w! - natural) / (m.src.length - 1), 3);
  });
  it("keeps decoded pictures of the same bytes but other sizes apart", () => {
    const px = new Uint8Array(16 * 3).fill(9);
    const pdf = parsePdf(writePdf({ pages: [[{ t: "image", id: "a", x: 0, y: 0, w: 2, h: 8 }, { t: "image", id: "b", x: 10, y: 0, w: 8, h: 2 }]], image: id => id === "a" ? { w: 2, h: 8, rgb: px, alpha: null } : { w: 8, h: 2, rgb: px, alpha: null }, font: () => undefined }));
    expect(pdf.all.filter(o => o.dict.includes("/Subtype/Image"))).toHaveLength(2);
  });
  it("refuses a variable font (fvar, gvar or CFF2): it is made static first (S3.2)", () => {
    const vf = read("fonts/Quicksand[wght].ttf");
    expect(() => writePdf({ ...pdfInput([fx.lists.text]), font: () => ({ key: "v", data: vf }) })).toThrow(/variable font \(fvar, gvar/);
  });
  it("marks a decorative copy as an artifact, so the text reads once", () => {
    const o = ops(writePdf(pdfInput([fx.lists.text], { compress: false })));
    expect(o).toMatch(/\/Artifact BMC q .*Tj ET Q EMC|\/Artifact BMC q .*TJ ET Q EMC/);
    expect(o.match(/\/Artifact BMC/g)).toHaveLength(1);
  });
  it("skips what draws nothing: empty runs (no font needed), zero-size rects and pictures", () => {
    const pdf = parsePdf(writePdf({ pages: [[{ t: "text", font: "None", size: 9, x: 0, y: 0, src: "", fill: { solid: [0, 0, 0] } }, { t: "rect", x: 5, y: 5, w: 0, h: 0, fill: { solid: [0, 0, 0] } }, { t: "image", id: "jpg", x: 0, y: 0, w: 0, h: 10 }]], image: id => fx.images.get(id), font: () => undefined, compress: false }));
    expect(pdf.all.some(o => o.dict.includes("/Subtype/Image") || o.dict.includes("/Type0"))).toBe(false);
    // a zero-width box (a hidden column, a 0 % data bar): no fill, but its stroke is drawn
    const zw = ops(writePdf(pdfInput([[{ t: "rect", x: 50, y: 0, w: 0, h: 200, fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: [0, 0, 0], a: 1 }, { o: 1, c: [9, 9, 9], a: 1 }] } }, { t: "rect", x: 60, y: 0, w: 0, h: 200, stroke: { w: 1, paint: { solid: [0, 0, 0] } } }]], { compress: false })));
    expect(zw).not.toContain(" sh Q");
    expect(zw).toContain("60 0 0 200 re S Q");
  });
  it("every page is a transparency group in RGB (Acrobat blends as Chrome does)", () => {
    expect(latin1(one(fx.lists.hit[1]))).toContain("/Group<</S/Transparency/CS/DeviceRGB>>/Resources");
  });
  it("refuses coordinates far outside any slide", () => {
    expect(validate([{ t: "rect", x: 1e21, y: 0, w: 1, h: 1, fill: { solid: [0, 0, 0] } }])[0]).toMatch(/x: outside ±1e6/);
  });
});

describe("pictures for the PDF", () => {
  it("decodes PNG: RGBA, grey, palette with tRNS, 16-bit, interlaced", () => {
    const rgba = decodePng(encodePng(3, 2, (x, y) => [x * 100, y * 100, 7, x === 2 ? 0 : 255]));
    expect([rgba.w, rgba.h]).toEqual([3, 2]);
    expect([...rgba.rgb.slice(0, 9)]).toEqual([0, 0, 7, 100, 0, 7, 200, 0, 7]);
    expect([...rgba.alpha!]).toEqual([255, 255, 0, 255, 255, 0]);
    expect(decodePng(encodePng(2, 2, () => [1, 2, 3, 255])).alpha).toBeNull();
    // hand-made PNGs of the other colour types (zlib streams of filtered rows)
    const png = (w: number, h: number, depth: number, type: number, rows: number[][], extra: [string, number[]][] = [], interlace = 0) => {
      const chunks: [string, Uint8Array][] = [["IHDR", new Uint8Array([0, 0, 0, w, 0, 0, 0, h, depth, type, 0, 0, interlace])], ...extra.map(([t, b]) => [t, new Uint8Array(b)] as [string, Uint8Array]),
        ["IDAT", (() => { const raw = rows.flatMap(r => [0, ...r]); return zlibSync(new Uint8Array(raw)); })()], ["IEND", new Uint8Array(0)]];
      const parts = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      for (const [t, b] of chunks) parts.push(0, 0, (b.length >> 8) & 255, b.length & 255, ...[...t].map(c => c.charCodeAt(0)), ...b, 0, 0, 0, 0);
      return new Uint8Array(parts);
    };
    const pal = decodePng(png(4, 1, 2, 3, [[0b00011011]], [["PLTE", [10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]], ["tRNS", [0, 128]]]));
    expect([...pal.rgb]).toEqual([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
    expect([...pal.alpha!]).toEqual([0, 128, 255, 255]);
    const g16 = decodePng(png(2, 1, 16, 0, [[0x12, 0x34, 0xff, 0xff]]));
    expect([...g16.rgb]).toEqual([0x12, 0x12, 0x12, 255, 255, 255]);
    const ga = decodePng(png(1, 1, 8, 4, [[50, 60]]));
    expect([...ga.rgb, ...ga.alpha!]).toEqual([50, 50, 50, 60]);
    const g1 = decodePng(png(8, 1, 1, 0, [[0b10100000]]));
    expect([...g1.rgb].filter((_, i) => i % 3 === 0)).toEqual([255, 0, 255, 0, 0, 0, 0, 0]);
    // Adam7, 2 × 2: passes 1 (0,0), 6 (1,0), 7 (row 1)
    const il = decodePng(png(2, 2, 8, 0, [[11], [22], [33, 44]], [], 1));
    expect([...il.rgb].filter((_, i) => i % 3 === 0)).toEqual([11, 22, 33, 44]);
  });
  it("reads a JPEG's size and components", () => {
    expect(jpegInfo(read("images/wall-blur.jpg"))).toEqual({ w: 800, h: 450, comps: 3, adobe: false });
  });
});

describe("text as glyph outlines in the SVG (S4.4)", () => {
  it("a run drawn as outlines: one group scaled to the size, each glyph defined once and used at its pen", async () => {
    const { svgChunks } = await import("../src/dl/svg");
    const t = (x: number, src: string) => ({ t: "text" as const, font: "F", size: 20, x, y: 50, src, w: 30, fill: { solid: [0, 0, 0] as [number, number, number] } });
    const svg = svgChunks([t(10, "aa"), t(60, "ab")], { imageHref: () => undefined, idPrefix: "q", outline: n => ({ upem: 1000, glyphs: [...n.src].map((c, i) => ({ key: "F-" + c, d: "M0 0L10 0Z", x: i * 10 })) }) }).join("");
    expect(svg.match(/<path id=/g)?.length).toBe(2);                                   // "a" and "b" once each
    expect(svg.match(/<use /g)?.length).toBe(4);
    expect(svg).toContain(`transform="translate(10 50) scale(0.02 -0.02)"`);
    // the scale is not rounded to 3 decimals (12 px in 2048 units: 0.005859375)
    expect(svgChunks([{ ...t(0, "a"), size: 12 }], { imageHref: () => undefined, outline: () => ({ upem: 2048, glyphs: [{ key: "k", d: "M0 0Z", x: 0 }] }) }).join("")).toContain("scale(0.005859375 -0.005859375)");
    expect(svg).toContain(`x="500"`);                                                  // 10 px at 20 px / 1000 units
    expect(svg).not.toContain("<text");
  });
});

