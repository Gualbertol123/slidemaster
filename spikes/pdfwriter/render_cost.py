"""Time to rasterise every page at screen size with PDFium (the engine in Chrome/Edge; a proxy for viewer cost).
python3 render_cost.py a.pdf [b.pdf ...]"""
import sys, time, json
import pypdfium2 as pdfium
out = {}
for f in sys.argv[1:]:
    t0 = time.perf_counter(); doc = pdfium.PdfDocument(f); n = len(doc); t1 = time.perf_counter()
    per = []
    for i in range(n):
        a = time.perf_counter(); doc[i].render(scale=1600 / 1200).to_pil(); per.append((time.perf_counter() - a) * 1000)
    out[f] = {"open_ms": round((t1 - t0) * 1000, 1), "render_ms_per_page_median": round(sorted(per)[n // 2], 1), "render_ms_total": round(sum(per))}
print(json.dumps(out, indent=1))
