/* A dialog moves the focus to its primary button once it is open – but not when the user is already in it: typing in
   its form, an Enter would press that button (the "Report a problem" form lost its text on a slow CI runner). */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Dialogs } from "../src/ui/Dialogs";
import { ask } from "../src/state/dialogs";

afterEach(() => cleanup());
const wait = (ms: number) => act(() => new Promise(r => setTimeout(r, ms)));

describe("dialog focus", () => {
  it("the primary button, when the user is not in the dialog yet", async () => {
    render(<Dialogs />);
    let answer: Promise<string | null> = Promise.resolve(null);
    await act(async () => { answer = ask("Title", `<input id="field">`, [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "OK", primary: true }]); });
    await wait(60);
    expect((document.activeElement as HTMLElement).dataset.a).toBe("ok");
    await act(async () => { (document.activeElement as HTMLButtonElement).click(); });
    expect(await answer).toBe("ok");
  });
  it("left alone when the user already typed in the dialog's form", async () => {
    render(<Dialogs />);
    let answer: Promise<string | null> = Promise.resolve(null);
    await act(async () => { answer = ask("Title", `<textarea id="text"></textarea>`, [{ id: "cancel", label: "Cancel" }, { id: "save", label: "Save", primary: true }]); });
    const text = document.getElementById("text") as HTMLTextAreaElement;
    text.focus();                                                                   // before the 30 ms
    await wait(60);
    expect(document.activeElement).toBe(text);
    await act(async () => { (document.querySelector('[data-a="cancel"]') as HTMLButtonElement).click(); });
    expect(await answer).toBe("cancel");
  });
});
