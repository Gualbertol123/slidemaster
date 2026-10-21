"""Google fonts fetched by the helper (gfonts.py): google/fonts on GitHub (raw.githubusercontent.com, else jsDelivr),
else the CSS API; the proxy setting; the messages. No network: fetch_url is a fake answering from a dict."""
import os
import shutil
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock

import test_http
from sbtest import TempDirs
from test_fonts import fake_font

from slidebuilder import fonts, gfonts, paths

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


class LocalAppData(object):
    """this PC's folder (%LOCALAPPDATA%) is the test's own: a proxy.txt of the PC running the tests is never read"""

    def setUp(self):
        super().setUp()
        self.local = os.path.join(self.tmp, "local")
        self._local = mock.patch.dict(os.environ, {"LOCALAPPDATA": self.local})
        self._local.start()

    def tearDown(self):
        self._local.stop()
        super().tearDown()


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


class Proxy(LocalAppData, TempDirs):
    def write(self, text, path=None):
        path = path or gfonts.proxy_file()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
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

    def test_this_pcs_proxy_txt_wins_over_the_shared_one(self):
        # a laptop at home or on VPN: the office proxy in the shared data folder would fail there
        self.write("proxy.bank.local:8080\n")
        local = os.path.join(self.local, "SlideBuilder", "proxy.txt")
        self.assertEqual(gfonts.local_proxy_file(), local)
        self.write("none\n", local)
        self.assertEqual(gfonts.proxy_source(), ("", local))
        self.assertEqual(self.proxies(), {})
        self.write("# nothing here\n", local)                                  # says nothing: the shared file
        self.assertEqual(gfonts.proxy_source(), ("http://proxy.bank.local:8080", gfonts.proxy_file()))
        msg = gfonts.unreachable_message([gfonts.NetError("https://raw.githubusercontent.com/x", None, "no answer (timed out)")])
        self.assertIn(gfonts.proxy_file() + " (http://proxy.bank.local:8080)", msg)
        self.assertIn(local + " (this PC only)", msg)
        # not Windows (no LOCALAPPDATA): the shared file alone
        with mock.patch.dict(os.environ):
            del os.environ["LOCALAPPDATA"]
            self.assertIsNone(gfonts.local_proxy_file())
            self.assertEqual(gfonts.proxy_setting(), "http://proxy.bank.local:8080")

    def test_a_refused_tunnel_keeps_the_proxys_status(self):
        # HTTPS through a proxy is a CONNECT: http.client raises OSError("Tunnel connection failed: 407 ..."), urllib
        # wraps it in a URLError, so no HTTPError carries the 407
        class Opener:
            def __init__(self, exc):
                self.exc = exc

            def open(self, req, timeout=None):
                raise self.exc
        tunnel = OSError("Tunnel connection failed: 407 Proxy Authentication Required")
        for exc in (urllib.error.URLError(tunnel), tunnel):
            with mock.patch.object(gfonts, "_opener", lambda: Opener(exc)):
                with self.assertRaises(gfonts.NetError) as cm:
                    gfonts.fetch_url(RAW + "ofl/roboto/METADATA.pb")
            self.assertEqual(cm.exception.status, 407)
        with mock.patch.object(gfonts, "_opener", lambda: Opener(urllib.error.URLError(tunnel))):
            with self.assertRaises(gfonts.GFontError) as cm:
                gfonts.family_faces("Roboto")
        self.assertEqual(cm.exception.status, 502)
        self.assertIn("password", str(cm.exception))
        with mock.patch.object(gfonts, "_opener", lambda: Opener(urllib.error.URLError(DNS))):
            with self.assertRaises(gfonts.NetError) as cm:
                gfonts.fetch_url(RAW + "ofl/roboto/METADATA.pb")
        self.assertEqual((cm.exception.status, cm.exception.reason), (None, "name not found (DNS)"))


class GoogleFontsHttp(LocalAppData, test_http.HttpBase):
    def forget(self):
        """another office: nothing in data\\fonts\\cache (B46) yet"""
        shutil.rmtree(gfonts.cache_dir(), ignore_errors=True)

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

    def test_a_rate_limit_on_github_goes_on_to_jsdelivr(self):
        # 429 (or any answer but 404) says nothing about the font: never "check the spelling"
        net = Net({RAW + "ofl/roboto/METADATA.pb": 429, JSD + "ofl/roboto/METADATA.pb": ROBOTO.encode(),
                   RAW + "ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf": 429, JSD + "ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf": fake_font()},
                  down={"fonts.googleapis.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
            self.assertEqual((st, res.get("source")), (200, "github"), res)
            st, h, data = self.file(res["faces"][0]["file"])
        self.assertEqual((st, data), (200, fake_font()))
        self.assertEqual([u.split("/")[2] for u in net.calls if u.endswith(".ttf")], ["raw.githubusercontent.com", "cdn.jsdelivr.net"])
        # a 429 from both mirrors and googleapis down: unreachable (502), not "not a Google font"
        self.forget()
        net = Net({RAW + "ofl/roboto/METADATA.pb": 429, JSD + "ofl/roboto/METADATA.pb": 429}, down={"fonts.googleapis.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
        self.assertEqual(st, 502)
        self.assertIn("HTTP 429", res["error"])

    def test_a_sign_in_page_is_not_the_repository(self):
        # a proxy's sign-in page answering 200 to METADATA.pb: the other mirror is asked, and never "check the spelling"
        page = b"<html><body><form>Sign in to the internet</form></body></html>"
        net = Net({RAW + "ofl/roboto/METADATA.pb": page, JSD + "ofl/roboto/METADATA.pb": ROBOTO.encode()})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
        self.assertEqual((st, res.get("source")), (200, "github"))
        self.forget()
        net = Net({RAW + "ofl/roboto/METADATA.pb": page, JSD + "ofl/roboto/METADATA.pb": page}, down={"fonts.googleapis.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Roboto")
        self.assertEqual(st, 502)
        self.assertIn("sign-in page", res["error"])
        self.assertNotIn("check the spelling", res["error"])

    def test_not_on_github_while_google_cannot_be_asked(self):
        # the office: googleapis does not resolve, and GitHub names the family's folder otherwise (or has no TTF files)
        with mock.patch.object(gfonts, "fetch_url", Net(down={"fonts.googleapis.com"})):
            st, res = self.get("Noto Sans Display Extra")
        self.assertEqual(st, 404)
        for words in ("not found on GitHub", "could not be asked", "name not found (DNS)", "Upload font files"):
            self.assertIn(words, res["error"])
        self.assertNotIn("check the spelling", res["error"])
        otf = 'name: "Otf"\nfonts {\n  style: "normal"\n  weight: 400\n  filename: "Otf-Regular.woff2"\n}\n'
        with mock.patch.object(gfonts, "fetch_url", Net({RAW + "ofl/otf/METADATA.pb": otf.encode()}, down={"fonts.googleapis.com"})):
            st, res = self.get("Otf")
        self.assertEqual(st, 404)
        self.assertIn("not found on GitHub", res["error"])

    def test_a_file_too_large_says_what_to_do(self):
        net = Net({RAW + "ofl/lato/Lato-400.ttf": fake_font()})
        with mock.patch.object(gfonts, "fetch_url", net), mock.patch.object(gfonts, "FONT_MAX", len(fake_font()) - 1):
            st, h, data = self.file("ofl/lato/Lato-400.ttf")
        self.assertEqual(st, 413)
        msg = data.decode("utf-8")
        for words in ("too large for the font library", "Upload font files", "static folder"):
            self.assertIn(words, msg)

    def test_unknown_family(self):
        net = Net({css_url(spec, "Robotto"): 400 for spec in (":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", "")}, down=())
        with mock.patch.object(gfonts, "fetch_url", net):
            st, res = self.get("Robotto")
        self.assertEqual(st, 404)
        self.assertIn("check the spelling", res["error"])
        self.assertIn("Upload font files", res["error"])
        # the unknown family alone is not "unreachable" when only the CSS API is down (test_not_on_github_while_...)
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


# ---------------------------------------------------------------------------------------------------- B46 cache
ROBOTO_FILES = {RAW + "ofl/roboto/METADATA.pb": ROBOTO.encode(), RAW + "ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf": fake_font(size=200),
                RAW + "ofl/roboto/Roboto-Italic%5Bwdth%2Cwght%5D.ttf": fake_font(b"true", 200)}
OFFLINE = {"raw.githubusercontent.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"}
SUBSET = "https://fonts.gstatic.com/l/font?kit=KFOmCnqEu92Fr1Me4GZNCzc&skey=a0a0114a1dcab3ac&v=v51"
SUBSET_CSS = "@font-face {\n  font-family: 'Roboto';\n  font-style: normal;\n  font-weight: 400;\n  src: url(%s) format('truetype');\n}\n" % SUBSET


def preview_css_url(family):
    return gfonts.CSS_API + family.replace(" ", "+") + "&text=" + urllib.parse.quote(family) + "&display=swap"


def sweep_4_0_0(lib):
    """fonts.py _sweep as 4.0.0 shipped it (git show v4.0.0:helper/slidebuilder/fonts.py:178-187), frozen: the share
    runs 4.0.0 until update day, and its helpers sweep the same data\\fonts folder"""
    from slidebuilder.fonts import FONT_TYPES, fonts_dir
    from slidebuilder.util import remove_quietly
    used = {x.get("file") for f in lib["fonts"] for x in f["faces"] if isinstance(x, dict)}
    try:
        names = os.listdir(fonts_dir())
    except OSError:
        return
    for n in names:
        if os.path.splitext(n)[1].lower() in FONT_TYPES and n not in used:
            remove_quietly(os.path.join(fonts_dir(), n))


class FontCache(LocalAppData, TempDirs):
    """data\\fonts\\cache\\ on the shared folder: several helpers read and write it at once (B46)"""

    def entries(self):
        d = gfonts.cache_dir()
        return sorted(n for n in os.listdir(d) if n.endswith(gfonts.CACHE_EXT)) if os.path.isdir(d) else []

    def add_roboto(self):
        res = gfonts.family_faces("Roboto")
        return res, [gfonts.face_file(f) for f in sorted({x["file"] for x in res["faces"]})]

    def test_a_second_pc_adding_the_same_family_makes_no_network_call(self):
        with mock.patch.object(gfonts, "fetch_url", Net(ROBOTO_FILES)):
            first = self.add_roboto()
        self.assertEqual(len(self.entries()), 3)                 # the family's faces and its two files
        net = Net(down=OFFLINE)
        with mock.patch.object(gfonts, "fetch_url", net):
            self.assertEqual(self.add_roboto(), first)
            self.assertEqual(gfonts.family_faces("roboto")["family"], "Roboto")       # the folder name is the key
        self.assertEqual(net.calls, [])
        self.assertEqual([n for n in os.listdir(gfonts.cache_dir()) if n.endswith(".tmp")], [])

    def test_a_half_written_or_corrupt_entry_is_fetched_again(self):
        ref = "ofl/roboto/Roboto[wdth,wght].ttf"
        with mock.patch.object(gfonts, "fetch_url", Net(ROBOTO_FILES)):
            data = gfonts.face_file(ref)
        path = gfonts._entry_path("file:" + ref)
        with open(path, "rb") as f:
            whole = f.read()
        flipped = whole[:-1] + bytes([whole[-1] ^ 1])
        for bad in (whole[:len(whole) // 2], whole[:3], b"", b"<html>" + whole[6:], flipped, whole + b"\0"):
            with open(path, "wb") as f:
                f.write(bad)
            net = Net(ROBOTO_FILES)
            with mock.patch.object(gfonts, "fetch_url", net):
                self.assertEqual(gfonts.face_file(ref), data)
            self.assertEqual(len(net.calls), 1, bad[:8])
            with open(path, "rb") as f:
                self.assertEqual(f.read(), whole)                 # written whole again
        # an entry that is whole but not a font (written by something else) is not served
        gfonts.cache_put("file:" + ref, b"<html>sign in</html>")
        net = Net(ROBOTO_FILES)
        with mock.patch.object(gfonts, "fetch_url", net):
            self.assertEqual(gfonts.face_file(ref), data)
        self.assertEqual(len(net.calls), 1)

    def test_a_vanished_or_locked_entry_is_a_miss(self):
        # another helper pruned it between the listing and the read, or (Windows) is replacing it right now
        gfonts.cache_put("k", b"abc")
        self.assertEqual(gfonts.cache_get("k"), b"abc")
        os.remove(gfonts._entry_path("k"))
        self.assertIsNone(gfonts.cache_get("k"))
        gfonts.cache_put("k", b"abc")
        for exc in (FileNotFoundError(2, "gone"), PermissionError(13, "sharing violation"), OSError(22, "SMB")):
            with mock.patch.object(gfonts, "open", side_effect=exc, create=True):
                self.assertIsNone(gfonts.cache_get("k"))
        self.assertEqual(gfonts.cache_get("k"), b"abc")

    def test_a_cache_that_cannot_be_written_does_not_fail_the_font(self):
        os.makedirs(os.path.dirname(gfonts.cache_dir()), exist_ok=True)
        with open(gfonts.cache_dir(), "w") as f:                  # (a file where the folder should be)
            f.write("x")
        with mock.patch.object(gfonts, "fetch_url", Net(ROBOTO_FILES)):
            res, files = self.add_roboto()
        self.assertEqual((res["source"], files[0]), ("github", fake_font(b"true", 200)))
        os.remove(gfonts.cache_dir())
        with mock.patch.object(gfonts, "write_atomic", side_effect=OSError(28, "disk full")), mock.patch.object(gfonts, "fetch_url", Net(ROBOTO_FILES)):
            self.assertEqual(self.add_roboto()[0]["source"], "github")

    def test_concurrent_writers_and_readers_see_whole_entries(self):
        # several helpers (threads here) write the same entries while others read them: a reader gets the whole
        # value or nothing, never a part
        values = {"k%d" % i: os.urandom(50000 + i) for i in range(4)}
        bad, stop = [], threading.Event()

        def write():
            for _ in range(15):
                for k, v in values.items():
                    gfonts.cache_put(k, v)

        def read():
            while not stop.is_set():
                for k, v in values.items():
                    got = gfonts.cache_get(k)
                    if got is not None and got != v:
                        bad.append(k)
        writers = [threading.Thread(target=write) for _ in range(3)]
        readers = [threading.Thread(target=read) for _ in range(2)]
        for t in writers + readers:
            t.start()
        for t in writers:
            t.join()
        stop.set()
        for t in readers:
            t.join()
        self.assertEqual(bad, [])
        self.assertEqual({k: gfonts.cache_get(k) for k in values}, values)
        self.assertEqual([n for n in os.listdir(gfonts.cache_dir()) if n.endswith(".tmp")], [])

    def test_the_cap_prunes_the_oldest_first(self):
        now = time.time()
        for i in range(6):
            gfonts.cache_put("e%d" % i, b"x" * 1000)
            os.utime(gfonts._entry_path("e%d" % i), (now - 600 + i * 60,) * 2)
        gfonts.cache_get("e0")                                    # read just now: used, so kept
        d = gfonts.cache_dir()
        stale_tmp, busy_tmp = os.path.join(d, "a.sbc.1.tmp"), os.path.join(d, "b.sbc.2.tmp")
        for p, age in ((stale_tmp, 2 * 3600), (busy_tmp, 5)):    # a crashed writer's; one being written right now
            with open(p, "wb") as f:
                f.write(b"y" * 500)
            os.utime(p, (now - age,) * 2)
        size = os.path.getsize(gfonts._entry_path("e0"))
        with mock.patch.object(gfonts, "CACHE_MAX", size * 5):
            gfonts.cache_put("new", b"x" * 1000)
        left = {k for k in ["e%d" % i for i in range(6)] + ["new"] if os.path.exists(gfonts._entry_path(k))}
        self.assertEqual(left, {"e0", "e4", "e5", "new"})        # e1-e3 oldest; down to 90 % of the cap
        self.assertFalse(os.path.exists(stale_tmp))
        self.assertTrue(os.path.exists(busy_tmp))

    def test_pruning_skips_a_file_in_use_and_goes_on(self):
        # Windows: a file another helper is reading cannot be deleted (sharing violation): the next oldest goes instead
        now = time.time()
        for i in range(4):
            gfonts.cache_put("e%d" % i, b"x" * 1000)
            os.utime(gfonts._entry_path("e%d" % i), (now - 600 + i * 60,) * 2)
        busy = gfonts._entry_path("e0")
        real = gfonts.remove_quietly
        size = os.path.getsize(busy)
        with mock.patch.object(gfonts, "remove_quietly", lambda p: False if p == busy else real(p)), \
                mock.patch.object(gfonts, "CACHE_MAX", size * 4):
            gfonts.cache_put("new", b"x" * 1000)
        left = {k for k in ("e0", "e1", "e2", "e3", "new") if os.path.exists(gfonts._entry_path(k))}
        self.assertEqual(left, {"e0", "e3", "new"})

    def test_a_family_older_than_a_month_is_asked_again_and_kept_when_google_cannot_be_reached(self):
        with mock.patch.object(gfonts, "fetch_url", Net(ROBOTO_FILES)):
            gfonts.family_faces("Roboto")
        p = gfonts._entry_path("family:roboto")
        old = time.time() - gfonts.FAMILY_MAX_AGE - 60
        os.utime(p, (old, old))
        net = Net(down=OFFLINE)
        with mock.patch.object(gfonts, "fetch_url", net):
            self.assertEqual(gfonts.family_faces("Roboto")["source"], "github")
        self.assertTrue(net.calls)
        os.utime(p, (old, old))
        renamed = ROBOTO.replace('name: "Roboto"', 'name: "Roboto Renamed"', 1)
        with mock.patch.object(gfonts, "fetch_url", Net({RAW + "ofl/roboto/METADATA.pb": renamed.encode()})):
            self.assertEqual(gfonts.family_faces("Roboto")["family"], "Roboto Renamed")
        self.assertGreater(os.path.getmtime(p), old + 60)

    def test_4_0_sweep_leaves_the_cache_alone(self):
        # until update day the share runs 4.0.0: its helpers delete the library's unused font files at the top of
        # data\fonts (fonts.py _sweep, the same in 4.6) when a family is removed; the cache folder is not one of them
        with mock.patch.object(gfonts, "fetch_url", Net(ROBOTO_FILES)):
            self.add_roboto()
        gfonts.cache_put("file:ofl/x/X.ttf", fake_font())
        before = self.entries()
        self.assertEqual(len(before), 4)
        unused = os.path.join(fonts.fonts_dir(), "Unused-400.ttf")
        with open(unused, "wb") as f:
            f.write(fake_font())
        lib = {"schema": 1, "fonts": [{"family": "Lato", "faces": [{"file": "Lato-400.ttf"}]}]}
        for sweep in (sweep_4_0_0, fonts._sweep):
            sweep(lib)
            self.assertEqual(self.entries(), before)
        self.assertFalse(os.path.exists(unused))                  # (the sweep did run)
        self.assertEqual(os.path.dirname(gfonts.cache_dir()), fonts.fonts_dir())
        self.assertEqual(os.path.splitext(gfonts.cache_dir())[1], "")         # no font extension on the folder


class PreviewHttp(LocalAppData, test_http.HttpBase):
    def preview(self, family, **kw):
        return self.req("GET", "/api/fonts/google/preview?family=" + urllib.parse.quote(family), **kw)

    def test_googleapis_subset_once_then_from_the_cache(self):
        net = Net({preview_css_url("Open Sans"): SUBSET_CSS.encode(), SUBSET: fake_font(size=80)}, down={"raw.githubusercontent.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, h, data = self.preview("Open Sans")
        self.assertEqual((st, data, h["content-type"]), (200, fake_font(size=80), "font/ttf"))
        self.assertEqual(net.calls, [preview_css_url("Open Sans"), SUBSET])
        net = Net(down=OFFLINE)
        with mock.patch.object(gfonts, "fetch_url", net):
            st, h, data = self.preview("Open Sans")
        self.assertEqual((st, data, net.calls), (200, fake_font(size=80), []))

    def test_the_github_regular_face_where_googleapis_does_not_answer(self):
        # the office: googleapis does not resolve; the family's regular file (shared with adding the family) is the preview
        net = Net(ROBOTO_FILES, down={"fonts.googleapis.com"})
        with mock.patch.object(gfonts, "fetch_url", net):
            st, h, data = self.preview("Roboto")
        self.assertEqual((st, data), (200, fake_font(size=200)))
        self.assertEqual([u for u in net.calls if u.endswith(".ttf")], [RAW + "ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf"])
        net = Net(down=OFFLINE)
        with mock.patch.object(gfonts, "fetch_url", net):
            self.assertEqual(self.preview("Roboto")[2], fake_font(size=200))
            self.assertEqual(gfonts.face_file("ofl/roboto/Roboto[wdth,wght].ttf"), fake_font(size=200))   # adding it later
        self.assertEqual(net.calls, [])

    def test_nothing_reachable(self):
        with mock.patch.object(gfonts, "fetch_url", Net(down=OFFLINE)):
            st, h, data = self.preview("Roboto")
        self.assertEqual(st, 502)
        self.assertIn(b"cannot be reached", data)

    def test_a_subset_link_elsewhere_is_never_fetched(self):
        css = SUBSET_CSS.replace(SUBSET, "https://evil.example/l/font?kit=x")
        net = Net({preview_css_url("Roboto"): css.encode()}, down={"raw.githubusercontent.com", "cdn.jsdelivr.net"})
        with mock.patch.object(gfonts, "fetch_url", net):
            self.assertEqual(self.preview("Roboto")[0], 502)
        self.assertFalse([u for u in net.calls if "evil" in u])

    def test_token_required(self):
        with mock.patch.object(gfonts, "fetch_url", Net()) as net:
            self.assertEqual(self.preview("Roboto", token=False)[0], 403)
            self.assertEqual(self.req("GET", "/api/fonts/google/preview?family=Roboto&t=" + test_http.TOKEN, token=False)[0], 403)
            self.assertEqual(net.calls, [])
        self.assertEqual(self.preview("../x")[0], 400)
