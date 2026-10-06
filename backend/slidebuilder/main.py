"""Command line entry point: ``python slide_builder.py [--port 8765] [--no-browser] [--setup] [--install]``."""
import argparse
import atexit
import json
import os
import sys
import threading
import webbrowser

from . import APP_NAME, VERSION, paths
from .util import LOCAL, log


def port_in_use_by_us(port):
    """Another Slide Builder helper already answers on this port (unauthenticated /api/ping)."""
    try:
        with LOCAL.open("http://127.0.0.1:%d/api/ping" % port, timeout=1) as r:
            return json.load(r).get("app") == APP_NAME
    except Exception:
        return False


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="Slide Builder helper")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="do not open the app automatically")
    ap.add_argument("--setup", action="store_true", help="install the export engine (Playwright + Chromium) into this folder")
    ap.add_argument("--install", action="store_true", help="first-time set-up on this PC (Python packages, export engine, shared-folder check, desktop shortcut, self-test)")
    args = ap.parse_args(argv)
    if args.setup:
        from .installer import setup
        sys.exit(setup())
    if args.install:
        from .firstrun import run_install
        sys.exit(run_install())
    if os.environ.get("SLIDEBUILDER_SIM_FS_MS") is not None:      # load tests only (tools/loadtest.py)
        from . import simfs
        log("SIMULATION: +%g ms per data-folder file operation (SLIDEBUILDER_SIM_FS_MS) - not for real use" % simfs.install())

    from .engines import find_local_engine
    from .migrate import migrate
    from .server import App, make_server

    if not os.path.exists(paths.APP_FILE):
        print("slide_builder.html is missing in %s - build the app first (cd frontend && npm run build)." % paths.BACKEND)
        print("The helper starts anyway; the page explains what to do.")
    for d in (paths.EXPORT_DIR, paths.ENGINE_DIR, paths.DATA):
        os.makedirs(d, exist_ok=True)
    try:
        migrate()
    except Exception as e:                       # never block the start-up; the file stays for the next start
        log("the v2 settings could not be imported now (%s) - will retry at the next start" % e)
    try:
        from .store import upgrade_all
        done = upgrade_all()                      # saved setups in an older format → current (old files kept)
        if done:
            log("converted %d saved setup(s) to the current format; the old files are in data/backups/upgrades" % len(done))
    except Exception as e:                       # never block the start-up; files are converted when opened
        log("saved setups were not converted now (%s)" % e)

    httpd = None
    for port in range(args.port, args.port + 20):
        if port_in_use_by_us(port):
            log("Slide Builder is already running on port %d - opening it." % port)
            if not args.no_browser:
                webbrowser.open("http://127.0.0.1:%d/" % port)
            return
        try:
            httpd = make_server(port, App())
            break
        except OSError:
            continue
    if not httpd:
        print("No free port found.")
        sys.exit(1)
    app = httpd.app
    atexit.register(app.engine.stop)
    url = "http://127.0.0.1:%d/" % app.port
    print("=" * 64)
    print(" Slide Builder %s" % VERSION)
    print(" Workbooks: %s" % paths.ROOT)
    print(" Exports  : %s" % paths.EXPORT_DIR)
    print(" Data     : %s" % paths.DATA)
    print(" Engines  : " + ", ".join(e.name for e in app.engine.engines if e.installed()) + " (testing in the background…)")
    if not find_local_engine():
        print(" Tip      : click the 'Export' status in the app, or run backend\\Install export engine.bat,")
        print("            to install Chrome for Testing into the engine folder (needed when Edge is locked down)")
    print(" Open     : %s" % url)
    print(" Keep this window open while you work. Ctrl+C to stop.")
    print("=" * 64)
    threading.Thread(target=app.engine.warm, daemon=True).start()
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        app.engine.stop()


if __name__ == "__main__":
    main()
