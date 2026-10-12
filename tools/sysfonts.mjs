/* The folders of this machine's font files for the helper's /sysfonts (SLIDEBUILDER_SYSFONTS), which the native export
   (PLAN S3.7) embeds fonts from. On Windows the helper reads the Windows font folders itself (""); elsewhere (CI's
   Linux) the folders under the usual font roots that hold .ttf / .otf / .ttc files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function sysFontDirs() {
  if (process.platform === "win32") return "";
  const out = [];
  const walk = d => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (names.some(n => n.isFile() && /\.(ttf|otf|ttc)$/i.test(n.name))) out.push(d);
    for (const n of names) if (n.isDirectory()) walk(path.join(d, n.name));
  };
  ["/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".fonts"), path.join(os.homedir(), ".local/share/fonts")].forEach(walk);
  return out.join(path.delimiter);
}
