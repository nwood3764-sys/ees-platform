#!/usr/bin/env python3
"""Headless Audit Template Builder: run build50121XML() outside a browser session.

Loads audit-template-builder/frontend/index.html in Chromium with the blocked
CDN scripts stubbed out, feeds it the four source documents (2 Asset Score PDFs
+ 2 OpenStudio Results HTML files), and writes the baseline + improved 50121 XML.

  python3 gen50121.py --as-base base.pdf --as-imp imp.pdf \
                      --os-base base.html --os-imp imp.html --out /tmp/out

Asset Score PDFs are text-extracted with pypdf and reconstructed line-by-line
the way pdf.js does (group by y, sort by x) so parseAssetScore sees the same
text the live tool sees.  Alternatively pass --as-base-text/--as-imp-text with
pre-extracted text, or --fixture with a JSON {asBase,asImp,osBase,osImp} blob.
"""
import argparse, http.server, json, os, socketserver, sys, threading
from pathlib import Path

REPO_FRONTEND = Path(__file__).resolve().parents[1] / "frontend"

# CDN scripts index.html pulls from cdnjs (blocked by this environment's proxy).
# build50121XML touches none of them, so serve a stub that defines the globals.
CDN_STUB = """
(function(){
  var noop=function(){return new Proxy(function(){},{get:function(){return noop;},
    apply:function(){return noop;},construct:function(){return noop;}});};
  window.pdfjsLib = window.pdfjsLib || noop();
  window.JSZip    = window.JSZip    || noop();
  window.XLSX     = window.XLSX     || noop();
  window.saveAs   = window.saveAs   || function(){};
  window.html2canvas = window.html2canvas || noop();
  window.jspdf    = window.jspdf    || {jsPDF: noop()};
})();
"""


def pdf_lines(path):
    """Extract text the way pdf.js does: group items by rounded y, sort by x."""
    from pypdf import PdfReader

    out = []
    reader = PdfReader(path)
    for page in reader.pages:
        rows = {}

        def visitor(text, cm, tm, font_dict, font_size, rows=rows):
            if not text or not text.strip():
                return
            rows.setdefault(round(tm[5]), []).append((tm[4], text))

        page.extract_text(visitor_text=visitor)
        for y in sorted(rows, reverse=True):
            out.append(" ".join(t for _, t in sorted(rows[y], key=lambda p: p[0])))
        out.append("\f")
    return "\n".join(out)


def serve(directory):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
        *a, directory=str(directory), **kw
    )
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-base"), ap.add_argument("--as-imp")
    ap.add_argument("--as-base-text"), ap.add_argument("--as-imp-text")
    ap.add_argument("--os-base"), ap.add_argument("--os-imp")
    ap.add_argument("--fixture")
    ap.add_argument("--frontend", default=str(REPO_FRONTEND))
    ap.add_argument("--out", default="out")
    ap.add_argument("--dump-parsed", action="store_true",
                    help="also write parsed-data.json (what build50121XML reads)")
    args = ap.parse_args()

    frontend = Path(args.frontend).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    payload = {"asBaseText": None, "asImpText": None,
               "osBaseHtml": None, "osImpHtml": None, "fixture": None}
    if args.fixture:
        payload["fixture"] = json.loads(Path(args.fixture).read_text())
    if args.as_base_text:
        payload["asBaseText"] = Path(args.as_base_text).read_text()
    elif args.as_base:
        payload["asBaseText"] = pdf_lines(args.as_base)
    if args.as_imp_text:
        payload["asImpText"] = Path(args.as_imp_text).read_text()
    elif args.as_imp:
        payload["asImpText"] = pdf_lines(args.as_imp)
    if args.os_base:
        payload["osBaseHtml"] = Path(args.os_base).read_text(errors="replace")
    if args.os_imp:
        payload["osImpHtml"] = Path(args.os_imp).read_text(errors="replace")

    httpd, port = serve(frontend)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        # CHROMIUM_PATH lets a pre-installed browser be used instead of a
        # Playwright-managed download (agent sandboxes ship one already).
        chromium = os.environ.get("CHROMIUM_PATH") or next(
            (str(c) for c in sorted(Path("/opt/pw-browsers").glob("chromium*/chrome-linux/chrome"))),
            None,
        )
        browser = p.chromium.launch(executable_path=chromium) if chromium else p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.route("https://cdnjs.cloudflare.com/**", lambda route: route.fulfill(
            status=200, content_type="application/javascript", body=CDN_STUB))
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")

        result = page.evaluate(
            """async (p) => {
              if (p.fixture) { Object.assign(data, p.fixture); }
              if (p.asBaseText) { rawDocs.asBase = p.asBaseText; data.asBase = parseAssetScore(p.asBaseText); }
              if (p.asImpText)  { rawDocs.asImp  = p.asImpText;  data.asImp  = parseAssetScore(p.asImpText); }
              if (p.osBaseHtml) { data.osBase = parseOpenStudio(p.osBaseHtml); }
              if (p.osImpHtml)  { data.osImp  = parseOpenStudio(p.osImpHtml); }
              const baseline = await build50121XML('baseline');
              const improved = await build50121XML('improved');
              return { baseline, improved, parsed: JSON.parse(JSON.stringify(data)) };
            }""",
            payload,
        )
        browser.close()
    httpd.shutdown()

    (out / "baseline_50121.xml").write_text(result["baseline"])
    (out / "improved_50121.xml").write_text(result["improved"])
    if args.dump_parsed:
        (out / "parsed-data.json").write_text(json.dumps(result["parsed"], indent=2))
    if errors:
        print("page errors:", *errors[:10], sep="\n  ", file=sys.stderr)
    print(f"wrote {out}/baseline_50121.xml and {out}/improved_50121.xml")


if __name__ == "__main__":
    main()
