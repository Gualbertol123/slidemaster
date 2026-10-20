"""Google fonts fetched by the helper (gfonts.py): google/fonts on GitHub (raw.githubusercontent.com, else jsDelivr),
else the CSS API; the proxy setting; the messages. No network: fetch_url is a fake answering from a dict."""
import os
import socket
import urllib.parse
import urllib.request
from unittest import mock

import test_http
from sbtest import TempDirs
from test_fonts import fake_font

from slidebuilder import gfonts, paths

RAW, JSD = gfonts.GITHUB
ROBOTO = '''name: "Roboto"
designer: "Christian Robertson"
license: "OFL"
fonts {
  name: "Roboto"
  style: "normal"
  weight: 400
  filename: "Roboto[wdth,wght].ttf"
  copyright: "Copyright 2011 The \\"Roboto\\" Project Authors (https://github.com/googlefonts/roboto-classic)"
}
fonts {
  name: "Roboto"
  style: "italic"
  weight: 400
  filename: "Roboto-Italic[wdth,wght].ttf"
}
subsets: "latin"
axes {
  tag: "wdth"
  min_value: 75.0
  max_value: 100.0
}
axes {
  tag: "wght"
  min_value: 100.0
  max_value: 900.0
}
source {
  repository_url: "https://github.com/googlefonts/roboto-classic"
  files {
    source_file: "web/split/Roboto[wdth,wght].ttf"
    dest_file: "Roboto[wdth,wght].ttf"
  }
}
'''
LATO = "name: \"Lato\"\n" + "".join('fonts {\n  name: "Lato"\n  style: "%s"\n  weight: %d\n  filename: "Lato-%d%s.ttf"\n}\n' % (s, w, w, "i" if s == "italic" else "")
                                   for w in (100, 300, 400, 700, 900) for s in ("normal", "italic"))
CSS = """@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/roboto/v51/r400.ttf) format('truetype');
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/roboto/v51/r700.ttf) format('truetype');
}
@font-face {
  font-family: 'Roboto';
  font-weight: 400;
  src: url(https://evil.example/x.ttf) format('truetype');
}
"""
DNS = socket.gaierror(11001, "getaddrinfo failed")


class Net:
    """a fake internet: url -> bytes, or an int (HTTP status); a host in `down` does not resolve; others answer 404"""

    def __init__(self, pages=None, down=()):
        self.pages, self.down, self.calls = dict(pages or {}), set(down), []

    def __call__(self, url, timeout=None):
        self.calls.append(url)
        host = urllib.parse.urlsplit(url).netloc
        if host in self.down:
            raise gfonts.NetError(url, None, gfonts._reason(DNS))
        got = self.pages.get(url, 404)
        if isinstance(got, int):
            raise gfonts.NetError(url, got)
        return got


def css_url(spec=":ital,wght@0,400;0,700;1,400;1,700", family="Roboto"):
    return gfonts.CSS_API + family.replace(" ", "+") + spec + "&display=swap"


class Metadata(TempDirs):
    def test_parse_the_text_format(self):
        m = gfonts.parse_metadata(ROBOTO)
        self.assertEqual(m["name"], ["Roboto"])
        self.assertEqual([f["filename"][0] for f in m["fonts"]], ["Roboto[wdth,wght].ttf", "Roboto-Italic[wdth,wght].ttf"])
        self.assertIn('The "Roboto" Project', m["fonts"][0]["copyright"][0])
        self.assertEqual([(a["tag"][0], a["max_value"][0]) for a in m["axes"]], [("wdth", "100.0"), ("wght", "900.0")])
        self.assertEqual(m["source"][0]["files"][0]["dest_file"], ["Roboto[wdth,wght].ttf"])

    def test_variable_family_gives_regular_and_bold_from_one_file_per_style(self):
        faces = gfonts.pick_faces(gfonts.parse_metadata(ROBOTO), "ofl/roboto/")
        self.assertEqual([(f["weight"], f["style"], f["file"], f["variable"]) for f in faces], [
            (400, "normal", "ofl/roboto/Roboto[wdth,wght].ttf", True), (700, "normal", "ofl/roboto/Roboto[wdth,wght].ttf", True),
            (400, "italic", "ofl/roboto/Roboto-Italic[wdth,wght].ttf", True), (700, "italic", "ofl/roboto/Roboto-Italic[wdth,wght].ttf", True)])
        # a variable font whose range has no 400 (a display face 500-900) is added at its nearest weights
        light = ROBOTO.replace("min_value: 100.0", "min_value: 500.0")
        self.assertEqual([f["weight"] for f in gfonts.pick_faces(gfonts.parse_metadata(light), "ofl/roboto/")], [500, 700, 500, 700])

    def test_static_family_gives_its_regular_and_bold_files(self):
        faces = gfonts.pick_faces(gfonts.parse_metadata(LATO), "ofl/lato/")
        self.assertEqual([(f["weight"], f["style"], f["file"], f["variable"]) for f in faces], [
            (400, "normal", "ofl/lato/Lato-400.ttf", False), (700, "normal", "ofl/lato/Lato-700.ttf", False),
            (400, "italic", "ofl/lato/Lato-400i.ttf", False), (700, "italic", "ofl/lato/Lato-700i.ttf", False)])
        # no 400 and no bold: the weight nearest 400 alone
        thin = "".join('fonts { style: "%s" weight: %d filename: "Lato-%d.ttf" }\n' % (s, w, w) for w in (100, 300, 500) for s in ("normal", "italic"))
        self.assertEqual([f["weight"] for f in gfonts.pick_faces(gfonts.parse_metadata(thin), "ofl/lato/")], [300, 300])

    def test_css_api_faces_are_gstatic_files_only(self):
        self.assertEqual([(f["weight"], f["file"]) for f in gfonts.parse_css(CSS)],
                         [(400, "https://fonts.gstatic.com/s/roboto/v51/r400.ttf"), (700, "https://fonts.gstatic.com/s/roboto/v51/r700.ttf")])

    def test_repo_folder(self):
        self.assertEqual([gfonts.repo_dir(f) for f in ("Open Sans", "Source Sans 3", "IBM Plex Sans")], ["opensans", "sourcesans3", "ibmplexsans"])


class Proxy(TempDirs):
    def write(self, text):
        os.makedirs(paths.DATA, exist_ok=True)
        with open(gfonts.proxy_file(), "w", encoding="utf-8") as f:
            f.write(text)

    def proxies(self):
        # (a ProxyHandler without proxies installs nothing: a direct connection)
        return next((h.proxies for h in gfonts._opener().handlers if isinstance(h, urllib.request.ProxyHandler)), {})

    def test_proxy_txt_wins_over_the_environment(self):
        with mock.patch.dict(os.environ, {"HTTPS_PROXY": "http://env:1", "https_proxy": "http://env:1"}):
            self.assertIsNone(gfonts.proxy_setting())
            self.assertEqual(self.proxies().get("https"), "http://env:1")        # urllib's own lookup
            self.write("# the office proxy (IT, 2026-10)\n\nproxy.bank.local:8080\n")
            self.assertEqual(gfonts.proxy_setting(), "http://proxy.bank.local:8080")
            self.assertEqual(self.proxies(), {"http": "http://proxy.bank.local:8080", "https": "http://proxy.bank.local:8080"})
            self.write("none\n")
            self.assertEqual((gfonts.proxy_setting(), self.proxies()), ("", {}))


class GoogleFontsHttp(test_http.HttpBase):
    def get(self, family):
        return self.jreq("GET", "/api/fonts/google?family=" + urllib.parse.quote(family))

    def file(self, ref, **kw):
        return self.req("GET", "/api/fonts/google/file?ref=" + urllib.parse.quote(ref), **kw)

    def test_from_github_raw(self):
        net = Net({RAW + "ofl/roboto/METADATA.pb": ROBOTO.encode(), RAW + "ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf": fake_font()})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("roboto")
            self.assertEqual(st, 200, res)
            self.assertEqual((res["family"], res["source"], res["license"], len(res["faces"])), ("Roboto", "github", "ofl", 4))
            st, h, data = self.file(res["faces"][0]["file"])
        self.assertEqual((st, data), (200, fake_font()))
        self.assertNotIn(True, ["googleapis" in u for u in net.calls])

    def test_licence_folders_are_tried_in_turn_and_jsdelivr_when_github_does_not_resolve(self):
        net = Net({JSD + "apache/roboto/METADATA.pb": ROBOTO.encode(), JSD + "apache/roboto/Roboto%5Bwdth%2Cwght%5D.ttf": fake_font()},
                  down={"raw.githubusercontent.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
            self.assertEqual((st, res["source"], res["license"]), (200, "github", "apache"))
            st, h, data = self.file(res["faces"][1]["file"])
        self.assertEqual((st, data), (200, fake_font()))
        self.assertEqual([u.split("/gh/google/fonts@main/")[-1] for u in net.calls if "METADATA" in u and "jsdelivr" in u],
                         ["ofl/roboto/METADATA.pb", "apache/roboto/METADATA.pb"])

    def test_css_api_when_github_is_unreachable(self):
        net = Net({css_url(): CSS.encode(), "https://fonts.gstatic.com/s/roboto/v51/r400.ttf": fake_font()},
                  down={"raw.githubusercontent.com", "cdn.jsdelivr.net"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
            self.assertEqual((st, res["source"], [f["weight"] for f in res["faces"]]), (200, "googleapis", [400, 700]))
            st, h, data = self.file(res["faces"][0]["file"])
        self.assertEqual((st, data), (200, fake_font()))

    def test_nothing_reachable_says_what_to_do(self):
        # the office (2026-10): googleapis does not resolve; here GitHub does not either
        net = Net(down={"raw.githubusercontent.com", "cdn.jsdelivr.net", "fonts.googleapis.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
        self.assertEqual(st, 502)
        for words in ("cannot be reached", "Upload font files", "proxy.txt", "name not found (DNS)", "fonts.googleapis.com"):
            self.assertIn(words, res["error"])

    def test_a_proxy_that_wants_a_password(self):
        net = Net({RAW + "ofl/roboto/METADATA.pb": 407, JSD + "ofl/roboto/METADATA.pb": 407}, down={"fonts.googleapis.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
        self.assertEqual(st, 502)
        self.assertIn("password", res["error"])
        self.assertIn("Upload font files", res["error"])

    def test_unknown_family(self):
        net = Net({css_url(spec): 400 for spec in (":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", "")}, down=())
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Robotto")
        self.assertEqual(st, 404)
        self.assertIn("check the spelling", res["error"])
        self.assertIn("Upload font files", res["error"])
        # the unknown family alone is not "unreachable" when only the CSS API is down
        with mock.patch.object(gfonts, "fetch_url", Net(down={"fonts.googleapis.com"})):
            self.assertEqual(self.get("Robotto")[0], 404)

    def test_only_google_font_files_are_fetched(self):
        net = Net()
        with mock.patch.object(gfonts, "fetch_url", net):
            for ref in ("https://evil.example/x.ttf", "ofl/../../etc/x.ttf", "ofl/roboto/METADATA.pb", "http://fonts.gstatic.com/s/x.ttf",
                        "https://fonts.gstatic.com.evil.example/x.ttf", ""):
                st, h, data = self.file(ref)
                self.assertEqual(st, 403, ref)
            self.assertEqual(net.calls, [])
            # not a font (a captive portal's page)
            net.pages[RAW + "ofl/lato/Lato-400.ttf"] = b"<html>log in</html>"
            st, h, data = self.file("ofl/lato/Lato-400.ttf")
            self.assertEqual(st, 502)

    def test_token_required(self):
        with mock.patch.object(gfonts, "fetch_url", Net()) as net:
            self.assertEqual(self.req("GET", "/api/fonts/google?family=Roboto", token=False)[0], 403)
            self.assertEqual(self.file("ofl/lato/Lato-400.ttf", token=False)[0], 403)
            self.assertEqual(net.calls, [])
