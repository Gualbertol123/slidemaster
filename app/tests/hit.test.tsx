/* Hit-testing an exhibit (S7b.2 review M5): a cell the exhibit does not draw (the blank spacer row under the heads) has no
   box – the selection and the editor leave it out instead of stretching to the table's top left. */
import { describe, expect, it } from "vitest";
import { cellBox, cellFromPoint } from "../src/stage/hit";
import { deckOf } from "../../core/tests/corpus-deck";

describe("exhibit hit-testing", () => {
  it("drawn cells have their box; an undrawn one has none", async () => {
    const { ctx, slides } = await deckOf("deck20.json", "mckinsey"), L = slides[0].tables[0], c = ctx();
    const at = (r: number, col: number) => L.items.find(it => it.b.r === r && it.b.c === col)!;
    const vub = cellBox(at(8, 6), c);
    expect(vub && vub.bw > 0 && vub.bh > 0).toBe(true);
    expect(cellFromPoint(L, c, vub!.bx + vub!.bw / 2, vub!.by + vub!.bh / 2)?.b).toMatchObject({ r: 8, c: 6 });
    expect(cellBox(at(7, 6), c)).toBeNull();                                      // the blank row between heads and banks
  });
});
