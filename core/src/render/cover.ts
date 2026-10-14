/* Cover slides: the date a cover shows when it has none of its own (the cover and the contents are drawn by
   slide-dl.ts). */
export function todayLabel(locale = "en-GB") { return new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); }
