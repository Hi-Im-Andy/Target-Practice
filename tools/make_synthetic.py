"""
Make a synthetic test set: adds realistic airsoft BB holes at known positions
to the blank training photos, so hit detection can be measured before real
shot targets are available.

Usage:
    python tools/make_synthetic.py [--out web/test/data] [--variants 3] [--seed 1]

For every training photo it writes, at phone-canvas size (long side 1600 px):
    <name>_blank.rgba            the untouched photo (false-positive baseline)
    <name>_v<k>.rgba             the photo with holes
    <name>_v<k>.jpg              preview of the same image
    manifest.json                sizes, true paper corners and true hole centers

Holes are drawn at full camera resolution (perspective-correct ellipses with
ragged edges, torn paper fibres, what shows through the hole, slight blur and
JPEG compression), then downscaled, so they look like they would in a photo.
"""

import argparse
import json
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TRAIN = os.path.join(REPO, "Images", "Training")
LONG_SIDE = 1600

# Silhouette target paper size (inches) and hand-labelled paper corners
# (TL, TR, BR, BL) in 1600-px image coordinates. Corners outside the frame
# are extrapolated from the visible paper edges.
PAPER_IN = (12.5, 20.0)
CORNERS = {
    "IMG_20250104_140018": [[174, 167], [1000, 194], [1100, 1545], [70, 1533]],
    "IMG_20250104_140248": [[110, 15], [1020, 45], [1085, 1325], [226, 1444]],
    "IMG_20250104_140253": [[-146, 103], [908, -152], [1190, 1375], [145, 1515]],
}
BB_DIAM_IN = 0.236  # 6 mm

# What shows through a hole: (name, BGR colour range)
BACKGROUNDS = [
    ("cardboard", (60, 95, 130), (95, 135, 170)),
    ("wall_shadow", (120, 125, 125), (175, 180, 180)),
    ("dark", (30, 30, 30), (70, 70, 75)),
]


def homography(src, dst):
    return cv2.getPerspectiveTransform(np.float32(src), np.float32(dst))


def apply_h(H, x, y):
    v = H @ np.array([x, y, 1.0])
    return v[:2] / v[2]


def pick_holes(rng, H_p2i, size):
    """Return hole centres in paper inches: a group, a few flyers, one touching pair."""
    w, h = size
    pw, ph = PAPER_IN

    def ok(p):
        x, y = p
        if not (0.6 < x < pw - 0.6 and 0.6 < y < ph - 0.6):
            return False
        u, v = apply_h(H_p2i, x, y)
        return 30 < u < w - 30 and 30 < v < h - 30

    pts = []
    for _ in range(200):
        cx, cy = rng.uniform(2.5, pw - 2.5), rng.uniform(4, ph - 3)
        if ok((cx, cy)):
            break
    sd = rng.uniform(0.6, 1.4)
    tries = 0
    while len(pts) < 8 and tries < 500:
        tries += 1
        p = (cx + rng.normal(0, sd), cy + rng.normal(0, sd))
        if ok(p) and all(np.hypot(p[0] - q[0], p[1] - q[1]) > 0.35 for q in pts):
            pts.append(p)
    while len(pts) < 11 and tries < 1500:
        tries += 1
        p = (rng.uniform(0.8, pw - 0.8), rng.uniform(0.8, ph - 0.8))
        if ok(p) and all(np.hypot(p[0] - q[0], p[1] - q[1]) > 0.5 for q in pts):
            pts.append(p)
    # A touching pair: two BBs 0.7 diameters apart (one ragged hole).
    for _ in range(300):
        a = (rng.uniform(1.5, pw - 1.5), rng.uniform(1.5, ph - 1.5))
        ang = rng.uniform(0, np.pi)
        b = (a[0] + 0.7 * BB_DIAM_IN * np.cos(ang), a[1] + 0.7 * BB_DIAM_IN * np.sin(ang))
        if ok(a) and ok(b) and all(np.hypot(a[0] - q[0], a[1] - q[1]) > 0.6 for q in pts):
            pts += [a, b]
            break
    return pts


def draw_hole(img, rng, H_full, p_in, bg):
    """Draw one hole at paper position p_in onto the full-res BGR image."""
    r_in = BB_DIAM_IN / 2 * rng.uniform(0.95, 1.25)  # paper tears a little wider than the BB
    n = 28
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False)
    jag = 1 + 0.12 * rng.standard_normal(n)
    jag = np.convolve(np.r_[jag[-2:], jag, jag[:2]], np.ones(3) / 3, "valid")[1:-1]
    poly = []
    ring = []
    for a, j in zip(angles, jag):
        poly.append(apply_h(H_full, p_in[0] + r_in * j * np.cos(a), p_in[1] + r_in * j * np.sin(a)))
        ring.append(apply_h(H_full, p_in[0] + r_in * (j + 0.28) * np.cos(a), p_in[1] + r_in * (j + 0.28) * np.sin(a)))
    poly = np.int32(np.round(poly))
    ring = np.int32(np.round(ring))

    x0, y0 = np.min(ring, axis=0) - 6
    x1, y1 = np.max(ring, axis=0) + 6
    H, W = img.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = img[y0:y1, x0:x1].astype(np.float32)
    m_hole = np.zeros(roi.shape[:2], np.uint8)
    m_ring = np.zeros(roi.shape[:2], np.uint8)
    cv2.fillPoly(m_hole, [poly - [x0, y0]], 255)
    cv2.fillPoly(m_ring, [ring - [x0, y0]], 255)
    m_ring = cv2.subtract(m_ring, m_hole)

    lum = cv2.cvtColor(roi.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    # Torn fibres: light on dark ink, a faint shadow on light paper.
    fib = (m_ring > 0)
    on_dark = lum < 120
    fib_noise = rng.uniform(0.35, 0.75, size=roi.shape[:2])
    for c in range(3):
        ch = roi[..., c]
        light = ch * (1 - fib_noise) + 225 * fib_noise
        shadow = ch * 0.85
        ch[fib & on_dark] = light[fib & on_dark]
        ch[fib & ~on_dark] = shadow[fib & ~on_dark]

    lo, hi = np.array(bg[1], np.float32), np.array(bg[2], np.float32)
    base = lo + (hi - lo) * rng.uniform()
    # Inner shadow: the far side of the hole is darker.
    yy, xx = np.mgrid[0:roi.shape[0], 0:roi.shape[1]]
    cx, cy = np.mean(poly, axis=0) - [x0, y0]
    rr = np.hypot(xx - cx, yy - cy) / max(1.0, np.max(np.hypot(*(poly - np.mean(poly, axis=0)).T)))
    shade = 1 - 0.25 * np.clip(rr, 0, 1)
    noise = rng.normal(0, 6, size=roi.shape)
    hole_px = base[None, None, :] * shade[..., None] + noise
    sel = m_hole > 0
    roi[sel] = hole_px[sel]

    img[y0:y1, x0:x1] = np.clip(roi, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "web", "test", "data"))
    ap.add_argument("--variants", type=int, default=3)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    manifest = {"paper_in": PAPER_IN, "bb_diam_in": BB_DIAM_IN, "images": []}

    for name, corners in CORNERS.items():
        full = cv2.imread(os.path.join(TRAIN, name + ".jpg"))
        Hf, Wf = full.shape[:2]
        s = LONG_SIDE / max(Hf, Wf)
        size = (round(Wf * s), round(Hf * s))
        paper = [[0, 0], [PAPER_IN[0], 0], [PAPER_IN[0], PAPER_IN[1]], [0, PAPER_IN[1]]]
        H_p2i = homography(paper, corners)                       # inches -> 1600 px
        H_full = homography(paper, [[x / s, y / s] for x, y in corners])  # inches -> camera px

        def save(img_full, tag, holes):
            small = cv2.resize(img_full, size, interpolation=cv2.INTER_AREA)
            rgba = cv2.cvtColor(small, cv2.COLOR_BGR2RGBA)
            base = f"{name}_{tag}"
            open(os.path.join(args.out, base + ".rgba"), "wb").write(rgba.tobytes())
            cv2.imwrite(os.path.join(args.out, base + ".jpg"), small, [cv2.IMWRITE_JPEG_QUALITY, 88])
            manifest["images"].append({
                "file": base, "photo": name, "width": size[0], "height": size[1],
                "corners": corners,
                "holes": [{"xIn": float(p[0]), "yIn": float(p[1]),
                           "px": [float(v) for v in apply_h(H_p2i, *p)], "bg": b}
                          for p, b in holes],
            })

        save(full, "blank", [])
        for k in range(args.variants):
            img = full.copy()
            holes = []
            for p in pick_holes(rng, H_p2i, size):
                bg = BACKGROUNDS[rng.integers(len(BACKGROUNDS))]
                draw_hole(img, rng, H_full, p, bg)
                holes.append((p, bg[0]))
            img = cv2.GaussianBlur(img, (0, 0), 1.0)
            ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
            save(img, f"v{k}", holes)
            print(name, f"v{k}", len(holes), "holes")

    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)


if __name__ == "__main__":
    main()
