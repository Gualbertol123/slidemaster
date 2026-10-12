/* The Liquid Glass wallpaper in the page: drawn by the core (render/wallpaper.ts), put into <style id="wallcss">. */
import { makeWall, wallCss } from "@slide-builder/core/render/wallpaper";
import type { Style } from "@slide-builder/core/model/types";

let seq = 0;
export function applyWall(style: Style) {
  const n = ++seq;
  void makeWall(style).then(w => {
    if (!w || n !== seq) return;               // a later call wins
    document.getElementById("wallcss")?.remove();
    const st = document.createElement("style"); st.id = "wallcss";
    st.textContent = wallCss(w);
    document.head.appendChild(st);
  }).catch(e => console.error("wallpaper", e));
}
