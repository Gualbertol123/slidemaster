/* How fast this machine is against the reference PC, for the time limits of `npm run bench` (decision 2026-10-12).
   The budgets (PLAN Part F) hold on the reference PC; GitHub's runners are 1.3–1.6× slower and vary from run to
   run, so a fixed limit passed or failed there by chance. A fixed workload shaped like the sheet reader (scan bytes,
   parse numbers into typed arrays, a string map) is timed after a warm-up, median of 5; the time limits are scaled
   by (this machine ÷ the reference PC), never below 1. Memory and long-task limits are not scaled. */

/** the workload's median time on the reference PC (Windows 11, the machine in PROGRESS.md's measurements;
    31.6–33.0 ms over six runs on 2026-10-12) */
export const REFERENCE_MS = 32;

/** ~12 MB of row-like markup, the same every time (built once, not timed) */
let input = null;
function markup() {
  if (input) return input;
  const parts = [];
  for (let r = 1; r <= 120000; r++) parts.push(`<row r="${r}"><c r="A${r}"><v>${(r * 7919) % 100003}.${r % 97}</v></c><c r="B${r}" t="s"><v>${r % 500}</v></c></row>`);
  return (input = new TextEncoder().encode(parts.join("")));
}
function workload() {
  const bytes = markup();
  const nums = new Float64Array(240000), strs = new Map();
  let n = 0, i = 0;
  while ((i = bytes.indexOf(60, i)) >= 0) {                    // "<"
    if (bytes[i + 1] === 118 && bytes[i + 2] === 62) {           // "<v>"
      let j = i + 3, x = 0, f = 0, d = 1;
      for (; bytes[j] !== 60; j++) { const b = bytes[j]; if (b === 46) f = 1; else if (f) { d /= 10; x += (b - 48) * d; } else x = x * 10 + b - 48; }
      if (n % 2) { const k = "s" + x; strs.set(k, (strs.get(k) || 0) + 1); }
      nums[n++ % nums.length] = x; i = j;
    } else i++;
  }
  return nums[0] + strs.size;
}

/** the workload's median time here, in ms */
export function calibrationMs() {
  markup(); workload();
  const t = [];
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); workload(); t.push(performance.now() - t0); }
  return t.sort((a, b) => a - b)[2];
}

/** how much slower this machine is than the reference PC (≥ 1), and the time it measured */
export function speedFactor() {
  const ms = calibrationMs();
  return { ms, factor: REFERENCE_MS > 0 ? Math.max(1, ms / REFERENCE_MS) : 1 };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const ms = calibrationMs();
  console.log(`calibration: ${ms.toFixed(1)} ms (reference ${REFERENCE_MS} ms, factor ${REFERENCE_MS > 0 ? Math.max(1, ms / REFERENCE_MS).toFixed(2) : "–"})`);
}
