# core/src/pdf · the PDF writer

Display list (`../dl/types.ts`) → PDF 1.7 bytes, in pure TypeScript (no DOM, runs in a worker). ADR-003; ported
from `spikes/pdfwriter/pdf.ts` and completed in PLAN S3.1. The display list is the contract: the writer draws the
eight node types and nothing else, with the geometry of `../dl/geom.ts`, which the SVG and canvas backends use too.

```ts
import { writePdf } from "@slide-builder/core/pdf/writer";
const bytes = writePdf({ pages: [dl1, dl2], image: id => bytesOf(id), font: n => faceOf(n.font, n.b, n.i), title: "Weekly" });
```

| File | What |
|---|---|
| `writer.ts` | `writePdf(input)`: pages, shared resources, fonts, cross-reference table |
| `png.ts` | PNG → RGB + alpha (all colour types and bit depths, interlaced), JPEG size and components |
| `ttf.ts` | sfnt reader (cmap, hmtx, metrics, `OS/2.fsType`) and the fallback TrueType subsetter (from the spike) |

## Page and coordinates

* Every page is `MediaBox [0 0 1200 675]`; the content starts with `0.75 0 0 -0.75 0 675 cm`, so the display list's
  slide px (1600 × 900, y down) fill the page by construction. No marker, no fitting.
* Text is drawn with `1 0 0 -1 x y Tm` (upright glyphs in the flipped space), x / y = the run's baseline start.

## How each node is drawn

| Node | PDF |
|---|---|
| `rect` | `re` (square corners) or a path of 4 cubic corners; fill as below; a solid stroke is `S` with `w`, `J`, `d` and miter joins up to 10 (`0 j 10 M`, as the SVG and canvas backends); a gradient stroke (the glass rim) is the ring between the outline grown and shrunk by w/2, filled (`W* n`) with the gradient |
| `path` | `m` / `l` / `c` / `h`, `f` or `f*`; solid strokes only (the validator refuses a gradient stroke on a path) |
| `line` | `m l S`; a gradient stroke becomes the band it covers, filled |
| `image` | an image XObject, `/Interpolate true`. JPEG bytes are passed through (`DCTDecode`, grey / RGB / CMYK, Adobe-inverted CMYK decoded); PNG or a raster is Flate RGB with its alpha as an `/SMask`. Crop = a clip to the box and the whole picture grown behind it; rotation and flips = one `cm` about the box centre; `alpha` = `ca`; `shadow` = its own image XObject drawn first |
| `shadow` | 5 sharp layers of `a/5` each, grown by `spread` + blur · 0.6 · ((k + 1)/5 − 0.5), i.e. −18 % … +30 % of the blur (v3's `printcss.ts` `vectorShadow`, decision 2026-10-12). As CSS `box-shadow`, an outer shadow is clipped to outside its box (`W*` with a far rectangle) and an `inset` one to inside it, its hole the box moved by the offset and shrunk by the spread. Radii follow the spread rule of CSS backgrounds-3 |
| `text` | Type0 / Identity-H font. A shaped run (`gids` + `adv`) is a `TJ` with an adjustment wherever an advance differs from the font's width (kerning); a run with a measured width only is a `Tj` with `Tc` = (w − natural width) / (characters − 1), the gaps between characters, as the SVG's `textLength` and the canvas's `letterSpacing` spread it (the last glyph ends at x + w). Both use the widths written in `W` (two decimals), so a viewer places each glyph within 0.01 px of the display list. A `decorative` copy (a title's text shadow) is marked content `/Artifact`: drawn, not read as text twice (PDFium, Acrobat and `tools/pdfcheck.py` skip artifacts; plain `pypdf.extract_text()` does not). An empty run draws nothing. Underline / strike-through are `re f` at the fractions of `geom.ts` |
| `group` | `q`, `cm` (transform), clip (`W n`, in the transformed space), children, `Q`. With `alpha` or `blend: "multiply"` the children go into a form XObject with an isolated transparency group (`/Group <</S /Transparency /I true>>`), drawn once with `ca` / `CA` and `/BM /Multiply`: overlapping children do not show through each other |
| `hit` | nothing (editor-only) |

A zero-size rect is not filled (its stroke is drawn); a zero-size picture is not drawn. Every page is a transparency group in DeviceRGB (`/Group <</S /Transparency /CS /DeviceRGB>>`), so viewers blend as Chrome does.

### Paint

* Solid: `rg` / `RG`, with an ExtGState `ca` / `CA` when alpha < 1.
* Linear: an axial shading (`ShadingType 2`) with `Coords` in the **unit box** of the shape; the content clips to the
  shape and maps the box with `cm`, exactly as the SVG's `gradientTransform` and the canvas's transform at `fill()`.
* Radial: `ShadingType 3` on the unit circle, mapped by the box and then the ellipse `[rx 0 0 ry cx cy]`
  (elliptical, centre outside the box allowed: `radial-gradient(130% 85% at 16% -20%, …)`).
* Stops not at 0 / 1 extend their colour to the ends (a stitching function, `FunctionType 3`), both shadings
  `Extend [true true]`.
* A linear paint whose two points coincide is its last stop (CSS), in all three backends (`geom.ts` `paintOf`).
* Alpha that varies along the gradient: a **luminosity soft mask** (the G0 recipe, decision 2026-10-12: no flattened
  gradients) – a grey shading of the stops' alphas in a form, `/SMask <</S /Luminosity>>`, its BBox the shape's own extent in unit-box coordinates (a ring or band reaches outside its box), rounded out to quarters; uniform alpha is a plain
  `ca`. Colour and alpha interpolate separately (unpremultiplied).

## Shared resources (written once per document)

* **Images** by id and, behind that, by content hash (with the size, for decoded rasters): the same bytes under two ids are one XObject.
* **Shadings** by style (kind, unit coordinates, stops): every shape with the same gradient shares one shading and one
  soft mask, whatever its size (100 capsules → 1 shading + 1 grey shading + 1 mask).
* **ExtGStates** by (ca, CA, blend) and by soft mask.
* **Fonts** by the face's key (its content hash): one Type0 font per face per document, subset to the glyphs used.

## Fonts

* `input.font(textNode)` returns the face's file (`{ key, data }`); a missing one is an error (no silent fallback),
  and so is a font whose `OS/2.fsType` forbids embedding (restricted licence), and a variable font (`fvar`, `gvar`, `CFF2`: it is made static first, `../text/static.ts`).
* Subsetting: `input.subset(face, gids)` (S3.2: HarfBuzz `hb-subset`, glyph ids retained); without it, TrueType is
  subset by `ttf.ts` (glyph ids kept, unused glyphs emptied, composite components kept, `post` 3.0) and CFF is
  embedded whole. TrueType → `CIDFontType2` + `FontFile2` + `CIDToGIDMap /Identity`; CFF (OpenType) →
  `CIDFontType0` + `FontFile3 /OpenType`. Never Type 3, never a variable font.
* `W` lists each used glyph's advance from `hmtx` with two decimals (runs of consecutive ids share an array); `ToUnicode` maps each glyph
  back to its text (selection, search, copy).
* The subset tag is six capital letters derived from the face and its glyphs, so equal input gives equal bytes.

## File

`%PDF-1.7` with a binary comment, numbered objects, a classic cross-reference table and trailer (`/Root`, `/Info`
with `/Producer (Slide Builder)` and the title). **No object streams and no cross-reference streams**, so `qpdf --check`
and a text editor can read every object. Streams are Flate (fflate `zlibSync`, level 6), except JPEGs.
Deterministic: the same input gives the same bytes.

## Checking

* `core/tests/dl.test.ts`: every node type in the three backends, the PDF's structure (every xref offset, the
  operators per node, de-duplication, fonts, refusals).
* `npm run sp` (`tools/dlcheck.mjs`): each per-node fixture as a PDF, `tools/pdfcheck.py check` (qpdf, no Type 3, no
  variable font), rendered by PDFium and compared with the same display list on a Chromium canvas (ΔE 2 on 99.5 %
  of pixels, 1 px dilation), plus a negative control that must fail.
* `python tools/pdfcheck.py info|check|render|cost|text`.

## Not handled here (named for the steps that use the writer)

* A character missing from the font is its `.notdef` glyph and is missing from the text; browsers fall back to another
  font. Font fallback is the font registry's business (S3.2 onwards).
* JPEG EXIF orientation is not applied (browsers apply it): pictures are normalised in the image store (S3.4 / S3.7).
* The writer does not validate its input; the export path runs `validate()` first (S3.7).

## Known differences between viewers

* A 0.5 px hairline (Excel's "hair") is drawn at least one device pixel wide by PDFium (and Acrobat), lighter by the
  canvas; geometry is the same.
* PDFium samples a soft mask's shading function slightly differently from Chromium's canvas: up to ~6 grey levels in
  a fade (within the SP tolerance).
