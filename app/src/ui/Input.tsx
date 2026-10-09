/* An <input> whose `value` / `checked` the component writes to the element whenever it renders and the
   element shows something else, but never puts back after an event. That is how the chrome's inputs have
   always worked. React's controlled inputs instead restore the rendered value right after every event,
   which would snap sliders and colour pickers back while they are dragged (their changes are debounced)
   and undo typing in the wizard's boxes, which store the text without re-rendering.
   `onCommit` is the browser's own `change` event (when a colour picker closes, or a box is left after an
   edit); React's `onChange` fires on every input. */
import { useEffect, useLayoutEffect, useRef, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "checked" | "defaultChecked"> & {
  value?: string | number; checked?: boolean; onCommit?: (e: Event) => void;
};
export function Input({ value, checked, onCommit, defaultValue, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit); commit.current = onCommit;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (value !== undefined && el.value !== String(value)) el.value = String(value);
    if (checked !== undefined && el.checked !== checked) el.checked = checked;
  });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const f = (e: Event) => commit.current?.(e);
    el.addEventListener("change", f);
    return () => el.removeEventListener("change", f);
  }, []);
  return <input ref={ref} {...rest} defaultValue={value ?? defaultValue} defaultChecked={checked} />;
}
