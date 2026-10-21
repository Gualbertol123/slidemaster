/* Pins accepted.json entries to the differences they were signed for (05 §3.2, S4.4: an entry with a digest accepts
   exactly those): each entry that still carries "pinOn" gets the digest of the differences of its scope in a parity or
   dlparity run's --diffs file, or is removed when that run has none in its scope. Run it on the reference PC – the
   goldens' environment, where geometry, pixels, sizes and PDF text are compared (a text-only run states fewer
   differences, so it is refused) – then commit tests/parity/accepted.json.

     node tools/parity.mjs --diffs parity-diffs.json
     node tools/pin-accepted.mjs --tool parity --diffs parity-diffs.json
     node tools/dlparity.mjs --diffs dlparity-diffs.json
     node tools/pin-accepted.mjs --tool dlparity --diffs dlparity-diffs.json

   --accepted FILE   another accepted list (default tests/parity/accepted.json)
   --dry             print what would change, write nothing

   B48 (the Intesa Sanpaolo template in Excel and Excel Refined) is the first user: its entries of the kinds this
   environment cannot state (style with sizes, geometry, pixels, pdf-text) were written per deck / version / file with
   "pinOn"; its elements and text entries were pinned where they were made (those kinds do not depend on the fonts). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detailsDigest } from "./parity.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

/** the entries of `list` with "pinOn" for `tool`, pinned to `diffs` (in place); returns what changed */
export function pin(list, diffs, tool) {
  const SCOPE = ["deck", "design", "version", "file", "kind"], out = [], changes = [];
  for (const e of list) {
    if (!e.pinOn || (e.tool || "parity") !== tool) { out.push(e); continue; }
    const mine = diffs.filter(d => SCOPE.every(k => e[k] === undefined || e[k] === d[k]));
    if (!mine.length) { changes.push(`removed ${e.deck} · ${e.design} · ${e.version} · ${e.file} · ${e.kind} (no difference on this PC)`); continue; }
    const { pinOn, ...rest } = e; void pinOn;
    const pinned = { ...rest, digest: detailsDigest(mine) };
    out.push(pinned);
    changes.push(`pinned ${e.deck} · ${e.design} · ${e.version} · ${e.file} · ${e.kind}: ${mine.length} difference(s), ${pinned.digest}`);
  }
  return { list: out, changes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tool = arg("--tool", null), diffsFile = arg("--diffs", null), file = path.resolve(arg("--accepted", path.join(REPO, "tests", "parity", "accepted.json")));
  if (!tool || !diffsFile) { console.error("usage: node tools/pin-accepted.mjs --tool parity|dlparity --diffs FILE [--accepted FILE] [--dry]"); process.exit(2); }
  const diffs = JSON.parse(fs.readFileSync(diffsFile, "utf8")), list = JSON.parse(fs.readFileSync(file, "utf8"));
  // a full comparison only (the goldens' Chromium and fonts): it states geometry or pixels somewhere
  if (!diffs.some(d => d.kind === "geometry" || d.kind === "pixels")) {
    console.error("these differences are a text-only comparison (no geometry, no pixels): pin on the reference PC, where the goldens were captured");
    process.exit(1);
  }
  const { list: out, changes } = pin(list, diffs, tool);
  for (const c of changes) console.log(c);
  if (!process.argv.includes("--dry")) fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`${changes.length} entr${changes.length === 1 ? "y" : "ies"} ${process.argv.includes("--dry") ? "would change" : "changed"} in ${path.relative(process.cwd(), file)}`);
}
