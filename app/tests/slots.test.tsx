/* S14.P: the shared UI slots M14 and M15 fill without editing the same lines – the ribbon's Insert entries
   (InsertSlots.tsx: Insert chart ▾, then Shapes & icons… – Insert shape ▾ before 4.12 –, the ids the e2e tests click) and the side panel of the selected
   item (ItemPanel.tsx: nothing without a selected item). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { INSERT_SLOTS, InsertSlots } from "../src/ui/InsertSlots";
import { ItemPanel } from "../src/ui/ItemPanel";
import { ChartInsert } from "../src/ui/InsertChart";
import { ShapeInsert } from "../src/ui/ShapeTools";
import { LineInsert } from "../src/ui/LineTools";

afterEach(cleanup);
describe("UI slots (S14.P)", () => {
  it("the Insert entries, in order: chart (M14) then shape and line (M15, S15.3); disabled without a slide", () => {
    expect(INSERT_SLOTS).toEqual([ChartInsert, ShapeInsert, LineInsert]);
    const { container } = render(<InsertSlots />);
    const ids = [...container.querySelectorAll("button.tb")].map(b => b.id);
    expect(ids).toEqual(["chartBtn", "shapeBtn", "lineBtn"]);
    for (const b of container.querySelectorAll("button.tb")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
  it("the item panel draws nothing while no item is selected", () => {
    const { container } = render(<ItemPanel />);
    expect(container.innerHTML).toBe("");
  });
});
