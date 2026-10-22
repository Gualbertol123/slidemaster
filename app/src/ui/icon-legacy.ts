/* The 17 built-in icons of 4.3 (core/src/render/icons.ts ICONS, S9.4) and their counterparts in the Tabler set (4.12).
   The icon and shape window no longer offers the built-in ones: each is a true duplicate of a Tabler icon (the same
   picture; the built-ins are filled, so a filled Tabler icon where the set has one). A deck that has them keeps them –
   they are drawn, exported and edited as before (the core still resolves the names); Change icon… on one opens the
   window at its counterpart. */
export const LEGACY_ICONS: Record<string, string> = {
  "arrow-up": "tabler-filled:arrow-big-up", "arrow-down": "tabler-filled:arrow-big-down", check: "tabler:check",
  warning: "tabler-filled:alert-triangle", info: "tabler-filled:info-circle", flag: "tabler-filled:flag", star: "tabler-filled:star",
  bank: "tabler:building-bank", euro: "tabler:currency-euro", percent: "tabler:percentage", calendar: "tabler-filled:calendar",
  chart: "tabler:chart-bar", target: "tabler:target", bell: "tabler-filled:bell", pin: "tabler-filled:map-pin",
  bulb: "tabler-filled:bulb", lock: "tabler-filled:lock",
};
/** a built-in icon's Tabler counterpart (null: not a built-in name) */
export const legacyCounterpart = (name: unknown): string | null =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(LEGACY_ICONS, name) ? LEGACY_ICONS[name] : null;
