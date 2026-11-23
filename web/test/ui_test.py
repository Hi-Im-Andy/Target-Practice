"""
Drive the phone page end to end in headless Chrome at an iPhone-sized viewport.

    python3 tools/build_web.py
    python3 web/test/ui_test.py [--shots /tmp/tp-shots]

Uploads a synthetic target photo, accepts the auto-detected corners, taps the
aim point, runs the analysis, and checks that hits and stats appear. Also
exercises edit mode (remove a hit, add a hit). Screenshots go to --shots.
"""

import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PAGE = os.path.join(REPO, "docs", "index.html")
DATA = os.path.join(HERE, "data")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default="/tmp/tp-shots")
    ap.add_argument("--image", default="IMG_20250104_140018_v0")
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    photo = os.path.join(DATA, args.image + ".jpg")
    if not os.path.exists(photo):
        sys.exit("Run python3 tools/make_synthetic.py first")

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto("file://" + PAGE)
        page.screenshot(path=f"{args.shots}/1-start.png", full_page=True)

        page.set_input_files("#fileInput", photo)
        page.wait_for_selector("#s-corners.active", timeout=20000)
        page.wait_for_timeout(300)
        page.screenshot(path=f"{args.shots}/2-corners.png", full_page=True)
        conf = page.evaluate("window.__tp.st.confidence")
        print("corner confidence", round(conf, 2))

        # Drag the TL corner a little and back, to exercise the loupe.
        box = page.locator("#cornerCanvas").bounding_box()
        st = page.evaluate("({c: window.__tp.st.corners, w: window.__tp.st.photo.width, h: window.__tp.st.photo.height})")
        cw = st["w"] * 1.24
        scale = box["width"] / cw
        tlx = box["x"] + (st["c"][0][0] + st["w"] * 0.12) * scale
        tly = box["y"] + (st["c"][0][1] + st["h"] * 0.12) * scale
        page.mouse.move(tlx, tly)
        page.mouse.down()
        page.mouse.move(tlx + 6, tly + 4, steps=4)
        page.screenshot(path=f"{args.shots}/2b-loupe.png")
        page.mouse.move(tlx, tly, steps=4)
        page.mouse.up()

        page.click("#cornersNext")
        page.wait_for_selector("#s-aim.active", timeout=20000)
        # Tap the bullseye X of the silhouette (about 6.2 in, 13.0 in on the paper).
        box = page.locator("#aimCanvas").bounding_box()
        page.mouse.click(box["x"] + box["width"] * 6.2 / 12.5, box["y"] + box["height"] * 13.0 / 20)
        page.screenshot(path=f"{args.shots}/3-aim.png", full_page=True)
        page.click("#aimNext")
        page.wait_for_selector("#s-results.active", timeout=30000)
        page.wait_for_timeout(300)
        page.screenshot(path=f"{args.shots}/4-results.png", full_page=True)
        n_hits = page.evaluate("window.__tp.st.hits.length")
        stats_text = page.inner_text("#stats")
        tips_text = page.inner_text("#tips")
        print("hits", n_hits)
        print(stats_text.replace("\n", " | ")[:400])
        print("tips:", tips_text.split("\n")[0])

        # Edit: remove the first hit, then add one back at an empty spot.
        page.click("#editBtn")
        h0 = page.evaluate("window.__tp.st.hits[0]")
        ppi_w = page.evaluate("[window.__tp.st.warp.ppi, document.getElementById('resCanvas').width]")
        box = page.locator("#resCanvas").bounding_box()
        k = box["width"] / ppi_w[1] * ppi_w[0]
        page.mouse.click(box["x"] + h0["xIn"] * k, box["y"] + h0["yIn"] * k)
        after_remove = page.evaluate("window.__tp.st.hits.length")
        page.mouse.click(box["x"] + 2.0 * k, box["y"] + 2.0 * k)
        after_add = page.evaluate("window.__tp.st.hits.length")
        page.click("#unitSeg button[data-u=cm]")
        page.screenshot(path=f"{args.shots}/5-edit-cm.png", full_page=True)
        print("edit: remove ->", after_remove, " add ->", after_add)
        browser.close()

    ok = True
    if errors:
        print("JS errors:", json.dumps(errors, indent=1)); ok = False
    if n_hits < 8:
        print("FAIL: expected at least 8 hits on the synthetic photo"); ok = False
    if not (after_remove == n_hits - 1 and after_add == n_hits):
        print("FAIL: edit mode remove/add"); ok = False
    if "Group size" not in stats_text:
        print("FAIL: stats missing"); ok = False
    print("UI test", "passed" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
