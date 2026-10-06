#!/usr/bin/env python3
"""Build backend/slide_builder.html from these sources.

The app is shipped as ONE self-contained HTML file (it must work offline and from file://), so the
CSS and JavaScript below are inlined into shell.html at the marked placeholders:

  /*__UICSS__*/     <- ui.css      (editor chrome: toolbar, panels, wizard, dialogs)
  /*__SLIDECSS__*/  <- slide.css   (the slides themselves, both designs; also sent to the export engine)
  /*__JSZIP__*/     <- vendor/jszip.min.js (3.10.1, MIT) - unzips .xlsx in the browser
  /*__CORE__*/      <- core.js + drawing.js   (workbook reading, layout of tables, pictures)
  /*__APP__*/       <- app.js + scene.js + model.js + wizard.js
                       (Excel renderer + editor, scene model + Glass theme, presets, wizard)

All JS files share one global scope (plain <script>, no modules) and are concatenated in that order.
Usage:  python build.py        (run from anywhere)
"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "slide_builder.html")
rd = lambda *p: open(os.path.join(HERE, *p), encoding="utf-8").read()
html = rd("shell.html")
parts = {
    "__UICSS__": rd("ui.css"),
    "__SLIDECSS__": rd("slide.css"),
    "__JSZIP__": rd("vendor", "jszip.min.js"),
    "__CORE__": rd("core.js") + "\n" + rd("drawing.js"),
    "__APP__": rd("app.js") + "\n" + rd("scene.js") + "\n" + rd("model.js") + "\n" + rd("wizard.js"),
}
for k, v in parts.items():
    tag = "/*" + k + "*/"
    assert tag in html, "placeholder %s missing in shell.html" % tag
    html = html.replace(tag, v)
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print("built", OUT, "(%d KB)" % (len(html.encode("utf-8")) // 1024))
