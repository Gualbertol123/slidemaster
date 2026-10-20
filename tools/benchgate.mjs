/* How a bench decides its gates (decision 2026-10-20, PERF-4 of docs/next/AUDIT-2.md): a value fails above its limit
   + 10 %. On CI only, a timing gate (ms) fails only when it is over in TWO SEPARATE measurements: when the first pass
   is over, the scenario is measured again (a fresh page for tools/bench.mjs, a fresh process or run for the core's
   benches) and the gate fails only if the repeat is over too – GitHub's runners stall now and then for a few hundred
   ms, and one stall had failed a different gate on each of three merges. Every limit and every scaling stays as it is
   (PLAN Part F). Locally nothing changes: one pass decides. Size gates (KB, MB) are never repeated, and a value that
   was not measured (Infinity, null) fails without a repeat. */

export const SLACK = 1.1;
/** GitHub Actions (where the repeat applies) */
export const onCI = () => !!process.env.GITHUB_ACTIONS;
/** a timing gate: its value is a time in ms (sizes, memory and counts are not) */
export const isTiming = key => /_ms$/.test(key);
/** over the limit + slack (`strict`: at it too – the core benches' rule); a value not measured counts as over */
const over = (v, lim, slack, strict) => !(typeof v === "number" && (strict ? v < lim * slack : v <= lim * slack));
/** a number as the report prints it (one decimal, two below 10); a value not measured says so */
const num = v => typeof v !== "number" ? "not measured" : !Number.isFinite(v) ? String(v) : String(Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

/** the gates of `first` (key → value) against `limits` (key → limit; keys without a value are not gated). On CI, the
    timing gates over the limit are measured again once: `again(keys)` → key → value of a fresh measurement. Each gate:
    { key, limit, first, repeat?, pass, repeated } – `repeated`: it passed only on the repeat. `bad`: the keys that fail. */
export async function judge({ limits, first, again, ci = onCI(), slack = SLACK, strict = false, timing = isTiming }) {
  const gates = Object.entries(limits).filter(([k]) => k in first).map(([key, limit]) => ({ key, limit, first: first[key], pass: !over(first[key], limit, slack, strict), repeated: false, ...(strict ? { strict } : {}) }));
  const retry = ci && again ? gates.filter(g => !g.pass && timing(g.key) && Number.isFinite(g.first)) : [];
  if (retry.length) {
    const rep = await again(retry.map(g => g.key));
    for (const g of retry) { g.repeat = rep[g.key]; g.pass = g.repeated = !over(g.repeat, g.limit, slack, strict); }
  }
  return { gates, bad: gates.filter(g => !g.pass).map(g => g.key) };
}

/** a gate's numbers as the report prints them: "383.4 (limit 16 – OVER +10 %); repeated after a stall: 7.5 – passes" */
export function describe(g, slack = SLACK) {
  const mark = v => typeof v !== "number" ? " – OVER +10 %" : v > g.limit ? (over(v, g.limit, slack, g.strict) ? " – OVER +10 %" : " – over, within +10 %") : "";
  const head = `${num(g.first)} (limit ${num(g.limit)}${mark(g.first)})`;
  if (!("repeat" in g)) return head;
  return `${head}; repeated after a stall: ${num(g.repeat)}${mark(g.repeat)} – ${g.pass ? "passes" : "over in both measurements"}`;
}
/** the run's annotation of a failing gate (GitHub Actions; readable without the log's admin rights) */
export const annotation = (title, g) => `::error title=${title}::${num(g.first)}${"repeat" in g ? ` then ${num(g.repeat)} on the repeat` : ""} (limit ${num(g.limit)}, + 10 % allowed)`;
