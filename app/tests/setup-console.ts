/* Component tests (jsdom) fail on any console error or warning (PLAN S1.4: no React warning). They run React's
   development build, which reports misuse (missing keys, bad props, effects) there; the built page runs the
   production build, which reports nothing, so the e2e console checks cannot see these.
   Installed when the file loads, so what a beforeAll logs fails the first test after it. */
import { afterAll, afterEach, expect } from "vitest";

/* jsdom has no canvas; the app falls back without one */
const EXPECTED = [/^Not implemented: HTMLCanvasElement's getContext\(\) method/];
let seen: string[] = [];
const orig = { error: console.error, warn: console.warn };
for (const k of ["error", "warn"] as const) {
  console[k] = (...a: unknown[]) => { const m = a.map(String).join(" "); if (!EXPECTED.some(x => x.test(m))) seen.push(k + ": " + m); orig[k](...a); };
}
const check = () => { const s = seen; seen = []; expect(s, "console errors/warnings").toEqual([]); };
afterEach(check);
afterAll(check);
