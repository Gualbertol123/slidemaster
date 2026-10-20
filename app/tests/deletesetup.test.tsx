/* B44 follow-up (PROGRESS "Waiting for", 2026-10-20): "Delete setup" in the preset box, then the wizard for a new file
   – the deleted setup's linked workbooks (B22) must not be listed there. The preset's links joined the workbook's
   mirror before the box was shown, so the new wizard listed their sheets. The page talks to a fake helper here (no
   network): the deck with a preset linking Peers.xlsx, a delete, then the empty deck the helper starts. */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SheetMeta } from "@slide-builder/core/xlsx/types";
import type { Preset } from "@slide-builder/core/model/types";

const dlg = vi.hoisted(() => ({ choice: "delete", seen: [] as SheetMeta[][], drafts: [] as Preset[], confirmed: 0 }));
vi.mock("../src/state/dialogs", async orig => ({
  ...(await orig() as object),
  // the preset box: the test's choice the first time, then (the setup deleted, none left) never asked again
  ask: vi.fn(async (title: string) => title === "Saved preset found" ? dlg.choice : "cancel"),
  confirmBox: vi.fn(async () => { dlg.confirmed++; return true; }),
  alertBox: vi.fn(async () => undefined),
  // the wizard: what it would list (the mirror's sheets) and the preset it starts from (the worker's draft), then cancelled
  runWizard: vi.fn(async (wb: { meta: SheetMeta[] }, _name: string, start: Preset) => {
    dlg.seen.push(wb.meta.map(m => ({ ...m }))); dlg.drafts.push(JSON.parse(JSON.stringify(start))); return null; }),
}));

import { core, openFromFolder } from "../src/state/app";
import { runWizard } from "../src/state/dialogs";
import { get, initialState, useStore } from "../src/state/store";
import { backend } from "../src/sync/api";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { emptyDoc } from "@slide-builder/core/model/ops";
import type { WorkbookDoc } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = (f: string) => { const b = fs.readFileSync(path.join(here, "fixtures", f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

/** the workbooks the worker was asked to link into its book (core "link"), and when (vitest's call order) */
function workerLinks() {
  const spy = vi.spyOn(core(), "call");
  const links = () => spy.mock.calls.map((c, i) => ({ name: (c[1] as { name?: string }).name, at: spy.mock.invocationCallOrder[i] }))
    .filter((_, i) => spy.mock.calls[i][0] === "link");
  return { links, restore: () => spy.mockRestore() };
}

/** the helper, faked: the folder holds report.xlsx and Peers.xlsx; report.xlsx's deck is `doc` until it is deleted */
async function fakeHelper() {
  const wb = await indexWorkbook(bytes("report.xlsx")); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
  let doc: WorkbookDoc | null = { schema: 3, workbook: "report.xlsx", rev: 1, preset: { ...defaultPreset(wb), links: ["Peers.xlsx"] }, style: {}, edits: {} };
  const deleted: string[] = [];
  const B = backend as unknown as Record<string, unknown>, saved = { ...B };
  B.served = true;
  B.files = async () => ["report.xlsx", "Peers.xlsx"].map(name => ({ name, size: bytes(name).byteLength, mtime: 1 }));
  B.readFile = async (name: string) => { const buf = bytes(name); return { buf, mtime: 1, size: buf.byteLength }; };
  B.openDeck = async (name: string) => ({ key: name, writer: "anna@pc-anna#test0001",
    snapshot: { format: 4, gen: 1, workbook: name, lamport: 0, rev: doc?.rev || 0, frontier: {}, doc: doc ?? emptyDoc(name) } });
  B.deckTail = async () => ({ journals: {}, gen: 1 });
  B.deleteDeck = async (key: string) => { deleted.push(key); doc = null; return { id: "d1", workbook: key }; };
  return { deleted, restore: () => { for (const k of Object.keys(B)) if (!(k in saved)) delete B[k]; Object.assign(B, saved); } };
}

describe("Delete setup in the preset box (B44)", () => {
  let restore = () => { /* nothing */ };
  // each test opens report.xlsx from a closed page: no test relies on what the one before left open
  afterEach(() => { restore(); useStore.setState(initialState()); dlg.seen = []; dlg.drafts = []; dlg.confirmed = 0; });

  it("the wizard after the delete lists only the workbook's own sheets, not the deleted setup's linked workbook", async () => {
    const h = await fakeHelper(), w = workerLinks(); restore = () => { h.restore(); w.restore(); };
    dlg.choice = "delete";
    await openFromFolder("report.xlsx");
    expect(dlg.confirmed).toBe(1);
    expect(h.deleted).toEqual(["report.xlsx"]);
    expect(dlg.seen).toHaveLength(1);                         // the wizard for a new file
    expect(dlg.seen[0].length).toBeGreaterThan(0);
    expect(dlg.seen[0].filter(m => m.linked).map(m => m.name)).toEqual([]);
    // the worker's book too (B44's other half): Peers.xlsx was never linked into it, so neither its defaultPreset
    // draft nor the new file's deck can reach the deleted setup's linked sheets
    expect(w.links()).toEqual([]);
    expect(dlg.drafts).toHaveLength(1);
    expect(dlg.drafts[0].tables.length).toBeGreaterThan(0);
    expect(dlg.drafts[0].tables.filter(t => t.sheet.startsWith("[Peers.xlsx]")).map(t => t.sheet)).toEqual([]);
    expect(dlg.drafts[0].sheets.filter(n => n.startsWith("[Peers.xlsx]"))).toEqual([]);
    expect(dlg.drafts[0].links || []).toEqual([]);
  });

  it("the editing wizard of a kept setup still lists its linked workbook's sheets", async () => {
    const h = await fakeHelper(), w = workerLinks(); restore = () => { h.restore(); w.restore(); };
    dlg.choice = "wizard";
    // the wizard cancelled: the open goes on with the preset (not this test's concern – stopped after the wizard)
    const opening = openFromFolder("report.xlsx").catch(() => undefined);
    await vi.waitFor(() => expect(dlg.seen).toHaveLength(1), { timeout: 20000 });
    expect(h.deleted).toEqual([]);
    expect(dlg.seen[0].some(m => m.linked === "Peers.xlsx")).toBe(true);
    // linked into the worker's book once, before its wizard
    const wiz = vi.mocked(runWizard).mock.invocationCallOrder;
    expect(w.links().map(l => l.name)).toEqual(["Peers.xlsx"]);
    expect(w.links()[0].at).toBeLessThan(wiz[wiz.length - 1]);
    await opening;
  });

  it("Continue with preset opens the deck with its linked workbook's sheets", async () => {
    const h = await fakeHelper(), w = workerLinks(); restore = () => { h.restore(); w.restore(); };
    dlg.choice = "continue";
    await openFromFolder("report.xlsx");
    expect(dlg.seen).toHaveLength(0);
    expect(get().doc.open).toBe(true);
    expect(get().deck.wb!.meta.some(m => m.linked === "Peers.xlsx")).toBe(true);
    expect(w.links().map(l => l.name)).toEqual(["Peers.xlsx"]);   // once
  });
});
