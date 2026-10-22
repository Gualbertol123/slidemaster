/* The stage keeps its size while the main pointer button is held (M15's speed fix) and fits again when the button is
   released – also when the page never sees the release: a context menu took the pointer, or the button was let go
   outside the window (the next pointer move has no button down). A right-click does not hold it (4.9, the M15
   speed-fix review). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitOrDefer } from "../src/stage/Stage";

const ev = (type: string, init: MouseEventInit = {}) => dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));

describe("the stage's size while a button is held", () => {
  afterEach(() => { ev("pointerup"); });

  it("a press of the main button defers the fit until it is released", () => {
    const f = vi.fn();
    ev("pointerdown", { button: 0, buttons: 1 });
    fitOrDefer(f); fitOrDefer(f);
    expect(f).not.toHaveBeenCalled();
    ev("pointerup", { button: 0, buttons: 0 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a context menu ends the hold and runs the deferred fit", () => {
    const f = vi.fn();
    ev("pointerdown", { button: 0, buttons: 1 });
    fitOrDefer(f);
    ev("contextmenu", { button: 2 });
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn(); fitOrDefer(g);
    expect(g).toHaveBeenCalledTimes(1);                     // not held any more: fitted at once
  });

  it("a pointer moving with no button down ends the hold (a release outside the window); with the button down it does not", () => {
    const f = vi.fn();
    ev("pointerdown", { button: 0, buttons: 1 });
    fitOrDefer(f);
    ev("pointermove", { buttons: 1 });
    expect(f).not.toHaveBeenCalled();
    ev("pointermove", { buttons: 0 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a right or middle press does not hold the stage", () => {
    for (const button of [1, 2]) {
      ev("pointerdown", { button, buttons: button === 2 ? 2 : 4 });
      const f = vi.fn(); fitOrDefer(f);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
});
