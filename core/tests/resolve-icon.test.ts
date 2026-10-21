/* S14.P: icon names across sets (render/icons.ts resolveIcon; 09 §2.4, §3.5): tabler:x → the vendored icon when present,
   else the built-in x, else "info" marked missing. */
import { afterEach, describe, expect, it } from "vitest";
import { ICON_NAMES, resolveIcon, setVendoredIcons } from "../src/render/icons";
import type { PathCmd } from "../src/dl/types";

afterEach(() => setVendoredIcons(null));
describe("resolveIcon", () => {
  it("built-in names draw themselves; without the vendored set a Tabler name falls back to the built-in of that name", () => {
    for (const n of ICON_NAMES) expect(resolveIcon(n)).toEqual({ src: "builtin", name: n, asked: n, missing: false });
    expect(resolveIcon("tabler:target")).toEqual({ src: "builtin", name: "target", asked: "tabler:target", missing: false });
    expect(resolveIcon("tabler-filled:star")).toMatchObject({ src: "builtin", name: "star", missing: false });
  });
  it("an unknown name (or none, or a non-string) is \"info\", marked missing for the Issues panel", () => {
    for (const n of ["tabler:rocket-2", "rocket", "", undefined, 7, "tabler:", "__proto__", "tabler:__proto__"])
      expect(resolveIcon(n), String(n)).toMatchObject({ src: "builtin", name: "info", missing: true });
  });
  it("the vendored set wins for a Tabler name it has (outline and filled are separate sets); the others fall back", () => {
    const ring: PathCmd[] = [["M", 2, 12], ["L", 22, 12]];
    setVendoredIcons((set, name) => set === "tabler" && name === "target" ? [ring] : set === "tabler-filled" && name === "rocket" ? [ring, ring] : null);
    expect(resolveIcon("tabler:target")).toEqual({ src: "tabler", name: "target", asked: "tabler:target", missing: false, paths: [ring] });
    expect(resolveIcon("tabler-filled:rocket")).toMatchObject({ src: "tabler-filled", name: "rocket", paths: [ring, ring] });
    expect(resolveIcon("tabler:rocket")).toMatchObject({ src: "builtin", name: "info", missing: true });
    expect(resolveIcon("tabler-filled:target")).toMatchObject({ src: "builtin", name: "target", missing: false });
    expect(resolveIcon("target")).toMatchObject({ src: "builtin", name: "target" });          // a bare name stays built-in
  });
});
