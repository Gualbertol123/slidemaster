/* The operation vectors (S14.P review, 3): shared/ops-vectors.json, then every shared/ops-vectors.d/*.json in name order
   (m14.json for M14's charts, m15.json for M15's lines and icons – each branch appends only to its own file, so the
   two never edit the same lines). A name used twice is an error: each case is reported by its name. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARED = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../shared");
/** the vector files, main file first, as paths */
export function vectorFiles(dir = SHARED): string[] {
  const d = path.join(dir, "ops-vectors.d");
  const more = fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".json")).sort().map(f => path.join(d, f)) : [];
  return [path.join(dir, "ops-vectors.json"), ...more];
}
/** every case of every vector file (cases are untyped JSON: each test reads the fields it needs) */
export function loadVectors(dir = SHARED): any[] {
  const all: any[] = [], seen = new Map<string, string>();
  for (const f of vectorFiles(dir)) {
    const v = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!Array.isArray(v)) throw new Error(`${path.basename(f)}: not an array of vectors`);
    for (const x of v) {
      if (!x || typeof x.name !== "string" || !x.expect || !(x.fold || (x.doc && Array.isArray(x.ops)))) throw new Error(`${path.basename(f)}: a case without name / doc + ops or fold / expect`);
      if (seen.has(x.name)) throw new Error(`vector "${x.name}" in both ${seen.get(x.name)} and ${path.basename(f)}`);
      seen.set(x.name, path.basename(f)); all.push(x);
    }
  }
  return all;
}
