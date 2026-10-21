/* The Intesa Sanpaolo 16:9 template's colours (product owner 2026-10-21, B48: "the excel and excel refined will have to
   follow this template"; its pages 10–13). Excel and Excel Refined take them as their palette: the deck's default
   colour theme (Aurora) and the "Intesa Sanpaolo" theme resolve to them in these two designs (style.ts themeOf); any
   other theme the user picks, and every colour override, still applies. Liquid Glass and the consulting designs never
   read this file. The template itself (and its logo) is not part of the repository: the logo is the deck's own. */

/** the designs that follow the template */
export const isIsp = (d: unknown): d is "excel" | "clean" => d === "excel" || d === "clean";

/** the template's colours, RGB as its pages 11 and 13 give them */
export const ISP_RGB = {
  blu: "#003A79", verde: "#006C24", arancione: "#EC6400", giallo: "#ECBD00",
  p2905c: "#8DC2DF", p7740c: "#32903F", p1665c: "#EB690A", p110c: "#DCA900",
  p294up: "#005496", imi: "#597189", p876c: "#9F5F00", p7451c: "#819AC9",
  warmGray1: "#DDD4C7", p8403c: "#5E5B59", nero: "#1D1D1B",
} as const;
/** "colore Nero 50%": the subtitles' grey (the template's 7F7F7F) */
export const ISP_GREY = "#7F7F7F";

/** a colour at a transparency over white (page 10: "trasparenza del 25 %, del 50 % o del 75 %"), as one opaque colour */
export function ispTint(hex: string, transparency: number): string {
  const n = parseInt(hex.slice(1), 16), f = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * transparency).toString(16).padStart(2, "0");
  return ("#" + f(16) + f(8) + f(0)).toUpperCase();
}
/** the transparencies the template allows for charts and graphic elements (100 % opacity is crossed out, page 10) */
export const ISP_TRANSPARENCY = [.25, .5, .75] as const;

/** page 11, "Gamma colori per grafici ed elementi grafici": the colours of charts and graphic elements, in the order
    charts take them (blue first: the deck's accent) */
export const ISP_CHART_BASE = [ISP_RGB.blu, ISP_RGB.arancione, ISP_RGB.giallo, ISP_RGB.verde, ISP_RGB.p2905c, ISP_RGB.p7740c,
  ISP_RGB.p1665c, ISP_RGB.p110c, ISP_RGB.p294up, ISP_RGB.imi, ISP_RGB.p876c, ISP_RGB.p7451c];
/** the charts' colours: each at 25 % transparency (the template's first row; page 10 crosses out 100 %) */
export const ISP_CHART = ISP_CHART_BASE.map(c => ispTint(c, .25));
/** page 13, "Gamma colori per i testi": the colours texts may take (100 % opacity), with their names */
export const ISP_TEXT: [string, string][] = [[ISP_RGB.blu, "Blu"], [ISP_RGB.verde, "Verde"], [ISP_RGB.arancione, "Arancione"], [ISP_RGB.giallo, "Giallo"],
  [ISP_RGB.p2905c, "Pantone 2905C"], [ISP_RGB.p7740c, "Pantone 7740C"], [ISP_RGB.p1665c, "Pantone 1665C"], [ISP_RGB.p110c, "Pantone 110C"],
  [ISP_RGB.p294up, "Pantone 294UP"], [ISP_RGB.warmGray1, "Pantone Warm Gray 1"], [ISP_RGB.nero, "Nero"], [ISP_RGB.p876c, "Private Banking Pantone 876C"],
  [ISP_RGB.p7451c, "Pantone 7451C"], [ISP_RGB.p8403c, "Pantone 8403C"], [ispTint(ISP_RGB.nero, .8), "Nero trasparenza 80%"], [ISP_RGB.imi, "Banca IMI"]];
/** page 11's fills for boxes and shapes: every chart colour at 25, 50 and 75 % transparency (names for the swatches) */
export const ISP_FILLS: [string, string][] = ISP_CHART_BASE.flatMap(c => {
  const name = ISP_TEXT.find(([h]) => h === c)?.[1] || c;
  return ISP_TRANSPARENCY.map(t => [ispTint(c, t), `${name} · trasparenza ${t * 100}%`] as [string, string]);
});

/** the colour theme Excel and Excel Refined draw with in place of Aurora and "Intesa Sanpaolo" (style.ts themeOf): x is
    the accent of titles, cover band, contents and page numbers; c1–c4 the first chart colours (the Design… dot) */
export const ISP_THEME = { c1: ISP_RGB.blu, c2: ISP_RGB.arancione, c3: ISP_RGB.giallo, c4: ISP_RGB.verde, a1: ISP_RGB.blu, a2: ISP_RGB.arancione, x: ISP_RGB.blu } as const;
/** the themes that resolve to the template's colours in its designs */
export const ISP_THEME_IDS = ["aurora", "intesa"];

/** the chart colours of a deck in the template's designs (render/chart-dl.ts chartLook), or null where the template's
    palette does not apply (another design, or a colour theme the user picked): the accent at 25 % transparency first,
    then page 11's colours */
export function ispChartColors(style: { design: unknown; theme?: { id: string } | null; colors?: { accent?: string } | null }): string[] | null {
  if (!isIsp(style.design) || !ISP_THEME_IDS.includes(style.theme?.id || "aurora")) return null;
  const first = ispTint(/^#[0-9A-Fa-f]{6}$/.test(style.colors?.accent || "") ? style.colors!.accent! : ISP_RGB.blu, .25);
  return [first, ...ISP_CHART.filter(c => c !== first)];
}