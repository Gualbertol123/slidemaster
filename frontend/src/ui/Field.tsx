/* A text box for settings that are saved to the shared document. While it has the focus it keeps what
   you are typing: autosave, other people's changes and presence updates re-render the toolbar every few
   seconds and must never put the stored value back over your text. Enter or leaving the box applies it,
   Esc restores the stored value. */
import { useState } from "react";
import type { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onInput" | "onChange" | "onBlur" | "onFocus" | "onKeyDown"> & { value: string; onCommit: (v: string) => void };
export function Field({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input {...rest} value={draft ?? value}
    onFocus={() => setDraft(value)}
    onChange={e => setDraft((e.target as HTMLInputElement).value)}
    onKeyDown={e => {
      e.stopPropagation();
      const el = e.target as HTMLInputElement;
      if (e.key === "Enter") el.blur();
      if (e.key === "Escape") { setDraft(value); el.value = value; requestAnimationFrame(() => el.blur()); }
    }}
    onBlur={e => { const v = (e.target as HTMLInputElement).value; setDraft(null); if (v !== value) onCommit(v); }} />;
}
