/* LI-01: About › Licences can be read before any deck is open – the start screen has its own Licences… button, which
   opens the same dialog as ⚙ Options › About › Licences (the Options menu is disabled until a deck is open). */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Canvas } from "../src/ui/Chrome";
import { Dialogs } from "../src/ui/Dialogs";
import { get } from "../src/state/store";

afterEach(() => cleanup());

describe("licences on the start screen", () => {
  it("open without a deck", async () => {
    expect(get().deck.slides.length).toBe(0);
    render(<><Canvas /><Dialogs /></>);
    const btn = document.getElementById("emptyLicences") as HTMLButtonElement | null;
    expect(btn, "a Licences… button on the start screen").not.toBeNull();
    await act(async () => { btn!.click(); });
    for (let i = 0; i < 50 && !document.getElementById("licencesText"); i++) await act(() => new Promise(r => setTimeout(r, 20)));
    expect(document.getElementById("licencesText")?.textContent).toMatch(/^## zustand /m);
  });
});
