"""
Build a single self-contained HTML file from web/index.html + web/tp-core.js.

    python tools/build_web.py            # writes docs/index.html

docs/index.html can be served by GitHub Pages (Settings -> Pages -> main /docs)
or opened straight from the file system; it has no other dependencies.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
WEB = os.path.join(REPO, "web")
OUT = os.path.join(REPO, "docs", "index.html")


def main():
    html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    core = open(os.path.join(WEB, "tp-core.js"), encoding="utf-8").read()
    tag = '<script src="tp-core.js"></script>'
    if tag not in html:
        raise SystemExit("index.html no longer references tp-core.js")
    # Keep the closing script tag from appearing inside the inlined code.
    core = core.replace("</script", "<\\/script")
    html = html.replace(tag, "<script>\n" + core + "\n</script>")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", os.path.relpath(OUT, REPO), f"({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
