// @vitest-environment jsdom
/* The core's XML tokenizer (src/xlsx/xml.ts) against DOMParser (jsdom, in this test only – PLAN S2.2):
   1. for every corpus workbook, and for a synthetic one with what the corpus lacks (gradient fills, a custom
      theme, an x:-prefixed styles part with BOM and CRLF, mc:AlternateContent, chart frames, one-cell and
      absolute anchors) and its variants with empty parts, the JSON of what the readers make of rels,
      workbook, theme, styles (dxfs too) and drawings is identical with either parser;
   2. small documents with the XML features the tokenizer claims (entities, CDATA, namespaces, comments,
      processing instructions, DOCTYPE, BOM, line ends, attribute normalisation) read like the DOM. */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetPlatform, setPlatform, type XmlElement } from "../src/platform";
import { indexWorkbook } from "../src/xlsx/workbook";
import { readDrawing } from "../src/xlsx/drawing";
import { readRels } from "../src/xlsx/util";
import { parseXmlTree } from "../src/xlsx/xml";
import { featureWorkbook } from "./zipbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(here, "../../tests/corpus/workbooks");
const books = fs.readdirSync(CORPUS).filter(f => /\.xls[xm]$/i.test(f)).sort();
const domXml = { parse: (s: string) => new DOMParser().parseFromString(s, "application/xml") as never };

/** everything the XML readers produce for a workbook (the sheets' cells come from the regex parser: not here) */
async function snapshot(buf: ArrayBuffer) {
  const wb = await indexWorkbook(buf);
  const smallest = [...wb.meta].sort((a, b) => a.size - b.size)[0];
  if (smallest) await wb.ensure([smallest.name]);              // loads theme, shared strings and styles once
  const sh = wb.shared;
  const sheets = [];
  for (const m of wb.meta) sheets.push({ name: m.name, rels: await readRels(wb.zip, m.path), drawing: sh ? await readDrawing(wb.zip, m.path, sh) : null });
  return JSON.parse(JSON.stringify({
    meta: wb.meta, wbRels: wb.wbRels, skipped: wb.skipped, hiddenSheets: wb.hiddenSheets, extLinks: wb.extLinks, total: wb.total, ssSize: wb.ssSize, big: wb.big,
    shared: sh && { sst: sh.sst, sstRuns: sh.sstRuns, xfs: sh.xfs, dxfs: sh.dxfs, defaultFont: sh.defaultFont, theme: sh.theme, mdw: sh.mdw },
    sheets,
  }));
}

afterEach(() => resetPlatform());
async function sameWithBoth(ab: ArrayBuffer) {
  setPlatform({ xml: domXml }); const dom = await snapshot(ab);
  resetPlatform(); const own = await snapshot(ab);
  expect(own).toEqual(dom);
  expect(JSON.stringify(own)).toBe(JSON.stringify(dom));
  return own;
}

describe("XML tokenizer = DOMParser on the corpus", () => {
  it("has the corpus", () => expect(books.length).toBeGreaterThanOrEqual(9));
  for (const f of books) it(f, async () => {
    const buf = fs.readFileSync(path.join(CORPUS, f)); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    await sameWithBoth(ab);
  }, 120_000);
});

describe("XML tokenizer = DOMParser on what the corpus lacks", () => {
  it("gradient fills, custom theme, prefixed styles with BOM and CRLF, dxfs, drawings", async () => {
    const own = await sameWithBoth(featureWorkbook());
    // the features were really read (not two equal empties)
    expect(own.shared.xfs[1].fill).toMatch(/^#[0-9A-F]{6}$/);           // linear gradient: its first stop (accent1, tinted)
    expect(own.shared.xfs[2].fill).toBe("#D97B00");                  // path gradient: first stop, theme 5 = accent2
    expect(own.shared.theme.slice(0, 2)).toEqual(["FFFFFF", "111111"]);
    expect(own.shared.dxfs.length).toBe(3);
    expect(own.sheets[0].drawing.anchors.map((a: { type: string }) => a.type)).toEqual(["one", "abs"]);
    expect(own.sheets[0].drawing.charts).toEqual(["Chart 1"]);
    expect(own.sheets[0].drawing.anchors[0].objects[0].src).toMatch(/^data:image\/png;base64,/);
  });
  for (const part of ["xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/theme/theme1.xml", "xl/drawings/drawing1.xml", "xl/workbook.xml"])
    it("an empty " + part + " reads as with DOMParser", async () => {
      const ab = featureWorkbook({ [part]: "" });
      setPlatform({ xml: domXml }); let dom: unknown, domErr = "";
      try { dom = await snapshot(ab); } catch (e) { domErr = String(e); }
      resetPlatform(); let own: unknown, ownErr = "";
      try { own = await snapshot(ab); } catch (e) { ownErr = String(e); }
      expect(ownErr).toBe(domErr);
      expect(own).toEqual(dom);
    });
});

/** an element as plain data: what the readers can see of it */
function view(el: XmlElement): unknown {
  const kids = Array.from(el.children);
  return { name: el.localName, text: el.textContent, kids: kids.map(view) };
}
const both = (xml: string) => ({ own: parseXmlTree(xml), dom: new DOMParser().parseFromString(xml, "application/xml") });

describe("XML tokenizer = DOMParser on the details", () => {
  const cases: Record<string, string> = {
    entities: `<a t="&lt;&amp;&gt;&quot;&apos;&#65;&#x42;&#x1F600;">x &lt; y &amp; z &#169; &#xE9;</a>`,
    cdata: `<a><b><![CDATA[<not> & markup]]></b>tail</a>`,
    namespaces: `<x:root xmlns:x="urn:x" xmlns:r="urn:r" xmlns="urn:d"><x:c r:id="rId1" id="plain"><d/></x:c></x:root>`,
    "comments, PI, doctype": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!DOCTYPE a [<!ELEMENT a ANY>]>\n<!-- c --><a><!-- inner --><b>1</b><?pi x?><b>2</b></a>`,
    bom: `﻿<a><b/></a>`,
    "line ends": `<a v="1\r\n2\t3\n4\r5&#10;6">l1\r\nl2\rl3</a>`,
    whitespace: `<a>\n  <b> spaced </b>\n  <c xml:space="preserve">  kept  </c>\n</a>`,
    "self closing and attributes": `<a b = "1" c='2' d="x&#9;y"/>`,
    "deep mixed content": `<a>1<b>2<c>3</c>4</b>5<d/>6</a>`,
  };
  for (const [name, xml] of Object.entries(cases)) it(name, () => {
    const { own, dom } = both(xml);
    expect(view(own.documentElement)).toEqual(view(dom.documentElement as never));
    const ownAll = Array.from(own.getElementsByTagNameNS("*", "*")).map(e => [e.localName, ...attrs(e)]);
    const domAll = Array.from(dom.getElementsByTagNameNS("*", "*")).map(e => [e.localName, ...Array.from(e.attributes).map(a => a.name + "=" + a.value)]);
    expect(ownAll).toEqual(domAll);
  });
  const attrs = (e: XmlElement) => (e as unknown as { attrs: [string, string][] }).attrs.map(([k, v]) => k + "=" + v);

  it("namespaced attributes and lookups", () => {
    const { own, dom } = both(cases.namespaces);
    for (const doc of [own, dom] as const) {
      const c = doc.getElementsByTagNameNS("*", "c")[0];
      expect(c.getAttributeNS("urn:r", "id")).toBe("rId1");
      expect(c.getAttribute("r:id")).toBe("rId1");
      expect(c.getAttributeNS(null, "id")).toBe("plain");
      expect(c.getAttributeNS("urn:x", "id")).toBe(null);
      expect(doc.getElementsByTagNameNS("urn:d", "d").length).toBe(1);
      expect(doc.getElementsByTagNameNS("urn:x", "root").length).toBe(1);
      expect(doc.documentElement.getAttributeNS("http://www.w3.org/2000/xmlns/", "r")).toBe("urn:r");
    }
  });
  it("text outside the root is dropped; a document without an element reads as an empty error document", () => {
    expect(parseXmlTree(" <a>x</a> ").documentElement.textContent).toBe("x");
    for (const x of ["", "just text", "<?xml version=\"1.0\"?>"]) {
      const d = parseXmlTree(x);
      expect(d.documentElement.localName).toBe("parsererror");
      expect(d.getElementsByTagNameNS("*", "Relationship").length).toBe(0);
    }
  });
  it("deep trees do not overflow the stack", () => {
    const xml = "<a>".repeat(20000) + "x" + "</a>".repeat(20000), d = parseXmlTree(xml);
    expect(d.documentElement.textContent).toBe("x");
    expect(d.getElementsByTagNameNS("*", "a").length).toBe(20000);              // the document includes its root
  });
});
