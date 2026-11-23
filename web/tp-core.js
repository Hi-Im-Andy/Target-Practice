/*
 * Target Practice core: finds the target paper in a photo, straightens it,
 * detects shot holes and computes group statistics.
 *
 * Pure JavaScript with no dependencies, so the same file runs in the phone
 * browser (web/index.html) and in Node (web/test/run_tests.js).
 *
 * Images are plain objects: { width, height, data } where data is RGBA bytes
 * (the same layout as canvas ImageData).
 *
 * Coordinate conventions
 *   - Photo / warped pixels: x right, y down.
 *   - Paper inches: measured from the paper's top-left corner, x right, y down.
 *   - Shot inches (analysis): origin at the aim point, x right, y UP.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Basic image helpers
  // ---------------------------------------------------------------------------

  function grayFromRGBA(img) {
    const n = img.width * img.height;
    const out = new Float32Array(n);
    const d = img.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    }
    return out;
  }

  function channelFromRGBA(img, c) {
    const n = img.width * img.height;
    const out = new Float32Array(n);
    const d = img.data;
    for (let i = 0, j = c; i < n; i++, j += 4) out[i] = d[j];
    return out;
  }

  /** Area-average downscale of a single-channel image. */
  function resizeArea(src, w, h, nw, nh) {
    const out = new Float32Array(nw * nh);
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < nw; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let s = 0, c = 0;
        for (let yy = y0; yy < y1 && yy < h; yy++) {
          const row = yy * w;
          for (let xx = x0; xx < x1 && xx < w; xx++) { s += src[row + xx]; c++; }
        }
        out[y * nw + x] = c ? s / c : 0;
      }
    }
    return out;
  }

  /** Separable box blur with radius r (window 2r+1), edge-clamped. */
  function boxBlur(src, w, h, r) {
    if (r <= 0) return src.slice();
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = s / win;
        const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
        s += src[row + add] - src[row + sub];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / win;
        const add = Math.min(h - 1, y + r + 1), sub = Math.max(0, y - r);
        s += tmp[add * w + x] - tmp[sub * w + x];
      }
    }
    return out;
  }

  function percentile(arr, p) {
    // Histogram-based percentile for values in [0, 1024).
    const bins = new Uint32Array(1025);
    for (let i = 0; i < arr.length; i++) bins[Math.min(1024, Math.max(0, arr[i] | 0))]++;
    const target = p * arr.length;
    let acc = 0;
    for (let b = 0; b < bins.length; b++) { acc += bins[b]; if (acc >= target) return b; }
    return 1024;
  }

  function median(values) {
    if (!values.length) return 0;
    const s = Array.from(values).sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }

  // ---------------------------------------------------------------------------
  // Morphology (van Herk / Gil-Werman running min/max, O(1) per pixel)
  // ---------------------------------------------------------------------------

  function runningExtreme1D(src, dst, len, stride, offset, k, isMax, g, hbuf) {
    // g and hbuf are scratch buffers of length >= len + k.
    const r = k >> 1;
    const n = len + 2 * r;
    const pad = isMax ? -Infinity : Infinity;
    const at = (i) => {
      const j = i - r;
      return j < 0 || j >= len ? pad : src[offset + j * stride];
    };
    for (let i = 0; i < n; i++) {
      const v = at(i);
      if (i % k === 0) g[i] = v;
      else g[i] = isMax ? Math.max(g[i - 1], v) : Math.min(g[i - 1], v);
    }
    for (let i = n - 1; i >= 0; i--) {
      const v = at(i);
      if (i === n - 1 || (i + 1) % k === 0) hbuf[i] = v;
      else hbuf[i] = isMax ? Math.max(hbuf[i + 1], v) : Math.min(hbuf[i + 1], v);
    }
    for (let j = 0; j < len; j++) {
      // window in padded coords: [j, j + k - 1]
      const a = hbuf[j], b = g[j + k - 1];
      dst[offset + j * stride] = isMax ? Math.max(a, b) : Math.min(a, b);
    }
  }

  function squareFilter(src, w, h, k, isMax) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const size = Math.max(w, h) + 2 * k + 2;
    const g = new Float32Array(size), hb = new Float32Array(size);
    for (let y = 0; y < h; y++) runningExtreme1D(src, tmp, w, 1, y * w, k, isMax, g, hb);
    for (let x = 0; x < w; x++) runningExtreme1D(tmp, out, h, w, x, k, isMax, g, hb);
    return out;
  }
  const erode = (s, w, h, k) => squareFilter(s, w, h, k, false);
  const dilate = (s, w, h, k) => squareFilter(s, w, h, k, true);

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------

  function solveLinear(A, b) {
    // Gaussian elimination with partial pivoting. A is n x n (array of rows).
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /** Homography H (3x3, row-major array of 9) mapping src[i] -> dst[i]. */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solveLinear(A, b);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  function polygonArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return a / 2;
  }

  function isConvexQuad(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
      const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      if (Math.abs(z) < 1e-9) return false;
      const s = Math.sign(z);
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Paper detection: strongest straight-edged quadrilateral (Hough lines)
  // ---------------------------------------------------------------------------

  function sobel(g, w, h) {
    const mag = new Float32Array(w * h);
    const ang = new Float32Array(w * h); // gradient direction folded into [0, PI)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
        const gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
        mag[i] = Math.hypot(gx, gy) / 4;
        let a = Math.atan2(gy, gx);
        if (a < 0) a += Math.PI;
        if (a >= Math.PI) a -= Math.PI;
        ang[i] = a;
      }
    }
    return { mag, ang };
  }

  function lineIntersect(l1, l2) {
    const a1 = Math.cos(l1.theta), b1 = Math.sin(l1.theta);
    const a2 = Math.cos(l2.theta), b2 = Math.sin(l2.theta);
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-9) return null;
    return [(l1.rho * b2 - l2.rho * b1) / det, (a1 * l2.rho - a2 * l1.rho) / det];
  }

  function angleDiff(a, b) {
    // difference between two undirected angles in [0, PI)
    let d = Math.abs(a - b) % Math.PI;
    return d > Math.PI / 2 ? Math.PI - d : d;
  }

  /**
   * Find the four corners of the target paper.
   * Returns { corners: [TL, TR, BR, BL] in image pixels, confidence: 0..1 }.
   * Confidence below ~0.35 means "probably wrong, ask the user to adjust".
   */
  function findPaperQuad(img, opts) {
    opts = opts || {};
    const W = img.width, H = img.height;
    const s = Math.min(1, (opts.workSize || 480) / Math.max(W, H));
    const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
    let g = resizeArea(grayFromRGBA(img), W, H, w, h);
    g = boxBlur(boxBlur(g, w, h, 1), w, h, 1);
    const { mag, ang } = sobel(g, w, h);
    const thr = Math.max(4, percentile(mag, 0.8));

    // Hough transform, voting only near each pixel's gradient direction.
    const nT = 180, D = Math.ceil(Math.hypot(w, h)), nR = 2 * D + 1;
    const acc = new Float32Array(nT * nR);
    const cs = new Float32Array(nT), sn = new Float32Array(nT);
    for (let t = 0; t < nT; t++) { cs[t] = Math.cos(t * Math.PI / nT); sn[t] = Math.sin(t * Math.PI / nT); }
    const cap = 4 * thr;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const m = mag[i];
        if (m < thr) continue;
        const t0 = Math.round(ang[i] * nT / Math.PI);
        const wgt = Math.min(m, cap);
        for (let dt = -2; dt <= 2; dt++) {
          const t = (t0 + dt + nT) % nT;
          const r = Math.round(x * cs[t] + y * sn[t]) + D;
          acc[t * nR + r] += wgt;
        }
      }
    }

    // Peaks with non-maximum suppression.
    let maxV = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i] > maxV) maxV = acc[i];
    const peaks = [];
    const floor = 0.08 * maxV;
    for (let t = 0; t < nT; t++) {
      for (let r = 1; r < nR - 1; r++) {
        const v = acc[t * nR + r];
        if (v < floor) continue;
        let isMax = true;
        for (let dt = -4; dt <= 4 && isMax; dt++) {
          let tt = t + dt, rr0 = r;
          if (tt < 0) { tt += nT; rr0 = 2 * D - r; } else if (tt >= nT) { tt -= nT; rr0 = 2 * D - r; }
          for (let dr = -3; dr <= 3; dr++) {
            const rr = rr0 + dr;
            if (rr < 0 || rr >= nR || (dt === 0 && dr === 0)) continue;
            const u = acc[tt * nR + rr];
            if (u > v || (u === v && (tt * nR + rr) < (t * nR + r))) { isMax = false; break; }
          }
        }
        if (isMax) peaks.push({ theta: t * Math.PI / nT, rho: r - D, votes: v });
      }
    }
    peaks.sort((a, b) => b.votes - a.votes);

    const cos35 = Math.cos(20 * Math.PI / 180); // sides tilt at most ~20 degrees
    const vert = [], horiz = [];
    for (const p of peaks) {
      if (Math.abs(Math.cos(p.theta)) > cos35) { if (vert.length < 18) vert.push(p); }
      else if (Math.abs(Math.sin(p.theta)) > cos35) { if (horiz.length < 18) horiz.push(p); }
      if (vert.length >= 18 && horiz.length >= 18) break;
    }
    const xAt = (l, y) => (l.rho - y * Math.sin(l.theta)) / Math.cos(l.theta);
    const yAt = (l, x) => (l.rho - x * Math.cos(l.theta)) / Math.sin(l.theta);

    // Fraction of a side that is backed by a real edge in the image.
    function support(P, Q) {
      const dx = Q[0] - P[0], dy = Q[1] - P[1];
      const len = Math.hypot(dx, dy);
      if (len < 1) return 0;
      const nx = -dy / len, ny = dx / len;
      let normAng = Math.atan2(ny, nx); if (normAng < 0) normAng += Math.PI; if (normAng >= Math.PI) normAng -= Math.PI;
      const samples = 60;
      let ok = 0;
      for (let k = 0; k < samples; k++) {
        const t = 0.04 + 0.92 * k / (samples - 1);
        const px = P[0] + dx * t, py = P[1] + dy * t;
        let hit = false;
        for (let o = -2; o <= 2 && !hit; o++) {
          const xi = Math.round(px + nx * o), yi = Math.round(py + ny * o);
          if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) continue;
          const i = yi * w + xi;
          if (mag[i] >= 0.6 * thr && angleDiff(ang[i], normAng) < 0.35) hit = true;
        }
        if (hit) ok++;
      }
      return ok / samples;
    }

    function isClockwise(q) { return polygonArea(q) > 0; } // y-down image coords

    // Mean brightness just inside minus just outside a side (null if off-image).
    function sidePolarity(P, Q, cw) {
      const dx = Q[0] - P[0], dy = Q[1] - P[1];
      const len = Math.hypot(dx, dy);
      // For a clockwise quad in y-down coords the interior is to the right of P->Q.
      let nx = -dy / len, ny = dx / len;
      if (!cw) { nx = -nx; ny = -ny; }
      let sIn = 0, sOut = 0, c = 0;
      for (let k = 0; k < 40; k++) {
        const t = 0.05 + 0.9 * k / 39;
        const px = P[0] + dx * t, py = P[1] + dy * t;
        const xi = Math.round(px + nx * 3), yi = Math.round(py + ny * 3);
        const xo = Math.round(px - nx * 3), yo = Math.round(py - ny * 3);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h || xo < 0 || yo < 0 || xo >= w || yo >= h) continue;
        sIn += g[yi * w + xi]; sOut += g[yo * w + xo]; c++;
      }
      return c < 8 ? null : (sIn - sOut) / c;
    }

    let best = null;
    for (let a = 0; a < vert.length; a++) for (let b = a + 1; b < vert.length; b++) {
      let L = vert[a], R = vert[b];
      if (xAt(L, h / 2) > xAt(R, h / 2)) [L, R] = [R, L];
      if (xAt(R, h / 2) - xAt(L, h / 2) < 0.25 * w) continue;
      for (let c = 0; c < horiz.length; c++) for (let d = c + 1; d < horiz.length; d++) {
        let T = horiz[c], B = horiz[d];
        if (yAt(T, w / 2) > yAt(B, w / 2)) [T, B] = [B, T];
        if (yAt(B, w / 2) - yAt(T, w / 2) < 0.25 * h) continue;
        const q = [lineIntersect(L, T), lineIntersect(R, T), lineIntersect(R, B), lineIntersect(L, B)];
        if (q.some((p) => !p)) continue;
        if (q.some(([x, y]) => x < -0.1 * w || x > 1.1 * w || y < -0.1 * h || y > 1.1 * h)) continue;
        if (!isConvexQuad(q)) continue;
        const areaFrac = Math.abs(polygonArea(q)) / (w * h);
        if (areaFrac < 0.12) continue;
        const f = [support(q[0], q[1]), support(q[1], q[2]), support(q[2], q[3]), support(q[3], q[0])];
        const minF = Math.min(...f);
        if (minF < 0.35) continue;
        // Paper is light: just inside each side should not be much darker than just outside.
        const cw = isClockwise(q);
        let polPenalty = 1;
        for (let e = 0; e < 4; e++) {
          const pol = sidePolarity(q[e], q[(e + 1) % 4], cw);
          if (pol !== null && pol < -25) polPenalty *= 0.6;
        }
        const meanF = (f[0] + f[1] + f[2] + f[3]) / 4;
        const score = polPenalty * (0.5 * meanF + 0.5 * minF) * (0.35 + 0.65 * Math.sqrt(areaFrac));
        if (!best || score > best.score) best = { score, q, minF, meanF, polPenalty };
      }
    }

    if (!best) {
      const m = 0.1;
      return {
        corners: [[W * m, H * m], [W * (1 - m), H * m], [W * (1 - m), H * (1 - m)], [W * m, H * (1 - m)]],
        confidence: 0,
      };
    }
    return {
      corners: best.q.map(([x, y]) => [x / s, y / s]),
      confidence: Math.min(1, (best.minF * 0.5 + best.meanF * 0.5) * best.polPenalty),
    };
  }

  // ---------------------------------------------------------------------------
  // Perspective warp: photo quad -> straightened paper at `ppi` pixels/inch
  // ---------------------------------------------------------------------------

  function warpToPaper(img, corners, paperW, paperH, ppi) {
    const ow = Math.round(paperW * ppi), oh = Math.round(paperH * ppi);
    const dst = [[0, 0], [paperW, 0], [paperW, paperH], [0, paperH]];
    const Hp2i = homography(dst, corners); // paper inches -> image px
    const Hi2p = homography(corners, dst);
    const out = new Uint8ClampedArray(ow * oh * 4);
    const valid = new Uint8Array(ow * oh);
    const W = img.width, Hh = img.height, d = img.data;
    const sub = [0.25, 0.75];
    for (let v = 0; v < oh; v++) {
      for (let u = 0; u < ow; u++) {
        let r = 0, g = 0, b = 0, cnt = 0;
        for (const sy of sub) for (const sx of sub) {
          const [x, y] = applyH(Hp2i, (u + sx) / ppi, (v + sy) / ppi);
          const fx = x - 0.5, fy = y - 0.5;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= Hh - 1) continue;
          const ax = fx - x0, ay = fy - y0;
          const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
          const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
          r += d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
          g += d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11;
          b += d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11;
          cnt++;
        }
        const o = (v * ow + u) * 4;
        if (cnt) {
          out[o] = r / cnt; out[o + 1] = g / cnt; out[o + 2] = b / cnt;
          valid[v * ow + u] = cnt === 4 ? 1 : 0;
        } else { out[o] = out[o + 1] = out[o + 2] = 128; }
        out[o + 3] = 255;
      }
    }
    return { image: { width: ow, height: oh, data: out }, valid, ppi, paperW, paperH, Hp2i, Hi2p };
  }

  // ---------------------------------------------------------------------------
  // Hole detection on the straightened paper
  // ---------------------------------------------------------------------------

  const DEFAULT_DETECT = {
    holeDiamIn: 0.236,   // 6 mm airsoft BB
    minContrast: 38,     // minimum top-hat response (0-255) for a hole
    edgeMarginIn: 0.2,   // ignore a strip this wide along the paper edges
    template: null,      // [{xIn, yIn}] printed features to ignore
    templateRadiusIn: 0.18,
    debug: null,         // pass an array to receive rejected blobs and why
  };

  /** Suggested warp resolution so a hole is ~10 px across. */
  function suggestPpi(holeDiamIn, paperW, paperH) {
    let ppi = Math.min(60, Math.max(24, 10 / holeDiamIn));
    const maxPx = 1.4e6;
    if (paperW * paperH * ppi * ppi > maxPx) ppi = Math.sqrt(maxPx / (paperW * paperH));
    return ppi;
  }

  /** Label connected components of a binary mask (conn = 4 or 8). */
  function labelBinary(B, w, h, conn) {
    const label = new Int32Array(w * h).fill(-1);
    const comps = [];
    const stack = new Int32Array(w * h);
    const nb = conn === 4 ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < w * h; i++) {
      if (!B[i] || label[i] !== -1) continue;
      const id = comps.length, pix = [];
      let sp = 0; stack[sp++] = i; label[i] = id;
      while (sp) {
        const p = stack[--sp]; pix.push(p);
        const x = p % w, y = (p - x) / w;
        for (const [dx, dy] of nb) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!B[q] || label[q] !== -1) continue;
          label[q] = id; stack[sp++] = q;
        }
      }
      comps.push(pix);
    }
    return comps;
  }

  /** Fill enclosed background regions smaller than maxArea (closes ring-shaped responses). */
  function fillSmallHoles(B, w, h, maxArea) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = B[i] ? 0 : 1;
    for (const pix of labelBinary(inv, w, h, 4)) {
      if (pix.length > maxArea) continue;
      if (pix.length > 6 && shapeOf(pix, w).aspect > 1.6) continue; // only roundish gaps
      let touches = false;
      for (const p of pix) {
        const x = p % w, y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { touches = true; break; }
      }
      if (!touches) for (const p of pix) B[p] = 1;
    }
  }

  /** Shape of a component: area, centroid, moment ellipse, aspect, rotated-box extent. */
  function shapeOf(pix, w) {
    const A = pix.length;
    let sx = 0, sy = 0;
    for (const p of pix) { const x = p % w; sx += x; sy += (p - x) / w; }
    const cx = sx / A, cy = sy / A;
    let mxx = 0, myy = 0, mxy = 0;
    for (const p of pix) {
      const x = p % w, y = (p - x) / w;
      const dx = x - cx, dy = y - cy;
      mxx += dx * dx; myy += dy * dy; mxy += dx * dy;
    }
    mxx = mxx / A + 1 / 12; myy = myy / A + 1 / 12; mxy /= A;
    const tr = mxx + myy, det = mxx * myy - mxy * mxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
    const axisAng = 0.5 * Math.atan2(2 * mxy, mxx - myy);
    const ux = Math.cos(axisAng), uy = Math.sin(axisAng);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pix) {
      const x = p % w, y = (p - x) / w;
      const u = (x - cx) * ux + (y - cy) * uy, v = -(x - cx) * uy + (y - cy) * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    return {
      area: A, cx: cx + 0.5, cy: cy + 0.5,
      a: 2 * Math.sqrt(l1), b: 2 * Math.sqrt(l2), axisAng,
      aspect: Math.sqrt(l1 / l2),
      extent: A / ((maxU - minU + 1) * (maxV - minV + 1)),
    };
  }

  /**
   * Fraction of points on an ellipse ring around the blob whose colour differs
   * from the blob's colour. A real hole stands out from its surroundings all
   * the way round; gaps between printed marks do not.
   */
  function surroundDiff(img, s, color, thr, radii) {
    const w = img.width, h = img.height, d = img.data;
    const ux = Math.cos(s.axisAng), uy = Math.sin(s.axisAng);
    let n = 0, diff = 0;
    for (const f of radii || [1.6, 2.1]) {
      const ra = s.a * f + 1.5, rb = s.b * f + 1.5;
      for (let k = 0; k < 32; k++) {
        const t = k * Math.PI / 16;
        const eu = ra * Math.cos(t), ev = rb * Math.sin(t);
        const x = Math.round(s.cx - 0.5 + eu * ux - ev * uy), y = Math.round(s.cy - 0.5 + eu * uy + ev * ux);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        const dist = Math.max(Math.abs(d[i] - color[0]), Math.abs(d[i + 1] - color[1]), Math.abs(d[i + 2] - color[2]));
        n++; if (dist > thr) diff++;
      }
    }
    return n ? diff / n : 0;
  }

  /**
   * Split a blob made of several touching holes: peaks of the distance
   * transform are hole centres; each pixel goes to the peak it is "inside" most.
   */
  function splitBlob(pix, w, minPeak, minSep) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pix) {
      const x = p % w, y = (p - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 3, bh = maxY - minY + 3;
    const BIG = 1e9;
    const dt = new Float32Array(bw * bh);
    for (const p of pix) { const x = p % w, y = (p - x) / w; dt[(y - minY + 1) * bw + (x - minX + 1)] = BIG; }
    // Two-pass chamfer distance (1, sqrt2) to the nearest background pixel.
    const R2 = Math.SQRT2;
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x; if (!dt[i]) continue;
      dt[i] = Math.min(dt[i], dt[i - 1] + 1, dt[i - bw] + 1, dt[i - bw - 1] + R2, dt[i - bw + 1] + R2);
    }
    for (let y = bh - 2; y >= 1; y--) for (let x = bw - 2; x >= 1; x--) {
      const i = y * bw + x; if (!dt[i]) continue;
      dt[i] = Math.min(dt[i], dt[i + 1] + 1, dt[i + bw] + 1, dt[i + bw + 1] + R2, dt[i + bw - 1] + R2);
    }
    const peaks = [];
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x, v = dt[i];
      if (v < minPeak) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && dt[i + dy * bw + dx] > v) { isMax = false; break; }
      }
      if (isMax) peaks.push({ x, y, r: v });
    }
    peaks.sort((a, b) => b.r - a.r);
    const kept = [];
    for (const pk of peaks) {
      if (kept.every((k2) => Math.hypot(k2.x - pk.x, k2.y - pk.y) >= Math.max(minSep, 0.9 * k2.r + 0.9 * pk.r - 0.5 * minSep))) kept.push(pk);
    }
    if (kept.length <= 1) return [pix];
    const groups = kept.map(() => []);
    for (const p of pix) {
      const x = p % w - minX + 1, y = (p - (p % w)) / w - minY + 1;
      let best = 0, bestV = Infinity;
      kept.forEach((k2, j) => { const v = Math.hypot(x - k2.x, y - k2.y) - k2.r; if (v < bestV) { bestV = v; best = j; } });
      groups[best].push(p);
    }
    return groups.filter((g) => g.length > 0);
  }

  /**
   * Detect shot holes on a warped paper image.
   * Returns hits: [{ xIn, yIn, dIn, count, contrast, polarity }] in paper inches.
   */
  function detectHoles(warp, options) {
    const o = Object.assign({}, DEFAULT_DETECT, options || {});
    const img = warp.image, ppi = warp.ppi;
    const w = img.width, h = img.height, n = w * h;
    const valid = new Uint8Array(n);
    const margin = Math.round(o.edgeMarginIn * ppi);
    for (let y = margin; y < h - margin; y++) for (let x = margin; x < w - margin; x++) {
      valid[y * w + x] = warp.valid ? warp.valid[y * w + x] : 1;
    }

    const dPx = o.holeDiamIn * ppi;
    let k = Math.round(Math.max(0.45 * ppi, 2.4 * dPx));
    if (k % 2 === 0) k++;
    let kOpen = Math.max(3, Math.round(0.45 * dPx));
    if (kOpen % 2 === 0) kOpen++;

    // Top-hat responses: small light blobs (light) and small dark blobs (dark),
    // taking the strongest of the R, G and B channels.
    const light = new Float32Array(n), dark = new Float32Array(n);
    for (let c = 0; c < 3; c++) {
      const ch = boxBlur(channelFromRGBA(img, c), w, h, dPx > 7 ? 1 : 0);
      const op = dilate(erode(ch, w, h, k), w, h, k);
      const cl = erode(dilate(ch, w, h, k), w, h, k);
      for (let i = 0; i < n; i++) {
        // A dark hole needs light surroundings, a light hole needs darker ones.
        const lt = op[i] < 175 ? ch[i] - op[i] : 0;
        const dk = cl[i] > 110 ? cl[i] - ch[i] : 0;
        if (lt > light[i]) light[i] = lt;
        if (dk > dark[i]) dark[i] = dk;
      }
    }

    // A hole is usually a little wider than the BB once the torn fibres are included.
    const nominalArea = Math.PI * Math.pow(0.6 * dPx, 2);
    const minArea = Math.PI * Math.pow(0.36 * dPx, 2); // ~0.72 BB diameters
    const d = img.data;
    const blobs = [];
    const textBands = [];
    const reject = (s, reason, extra) => { if (o.debug) o.debug.push(Object.assign({ xIn: s.cx / ppi, yIn: s.cy / ppi, reason }, extra)); };
    for (const [M, polarity] of [[light, 'light'], [dark, 'dark']]) {
      const vals = [];
      for (let i = 0; i < n; i += 7) if (valid[i]) vals.push(M[i]);
      const med = median(vals);
      const mad = median(vals.map((v) => Math.abs(v - med))) || 1;
      const hi = Math.max(o.minContrast, med + 9 * mad);
      const lo = Math.max(0.45 * hi, med + 4 * mad);

      // Binary mask -> close small rings -> opening erases thin lines and digit strokes.
      const B = new Uint8Array(n);
      for (let i = 0; i < n; i++) B[i] = valid[i] && M[i] >= lo ? 1 : 0;
      fillSmallHoles(B, w, h, 1.5 * nominalArea);
      // Printed text: before the opening, a line of letters is a wide, short,
      // near-horizontal band (taller than a printed line).
      for (const mk of labelBinary(B, w, h, 8)) {
        if (mk.length < nominalArea) continue;
        const sh = shapeOf(mk, w);
        const len = 2 * sh.a / ppi, wid = 2 * sh.b / ppi;
        const ang = Math.abs(Math.atan2(Math.sin(sh.axisAng), Math.cos(sh.axisAng))) * 180 / Math.PI;
        const horiz = ang < 15 || ang > 165;
        if (horiz && len >= 0.5 && wid >= 0.07 && wid <= 0.35 && len / wid >= 3) {
          textBands.push({ s: sh, polarity });
        }
      }
      const opened = dilate(erode(Float32Array.from(B), w, h, kOpen), w, h, kOpen);
      for (let i = 0; i < n; i++) B[i] = opened[i] > 0.5 && valid[i] ? 1 : 0;

      for (const comp of labelBinary(B, w, h, 8)) {
        if (comp.length < 0.25 * minArea) continue;
        let pieces = [comp];
        let isSplit = false;
        if (comp.length > 1.4 * nominalArea && comp.length < 12 * nominalArea) {
          const s0 = shapeOf(comp, w);
          if (s0.area > 1.9 * nominalArea || s0.aspect > 1.25) {
            pieces = splitBlob(comp, w, 0.46 * dPx, 0.6 * dPx);
            isSplit = pieces.length > 1;
          }
        }
        for (const pix of pieces) {
          const s = shapeOf(pix, w);
          let peak = 0;
          for (const p of pix) if (M[p] > peak) peak = M[p];
          const info = { polarity, area: s.area / nominalArea, aspect: s.aspect, extent: s.extent, peak, split: isSplit };
          if (s.area < minArea) { reject(s, 'small', info); continue; }
          if (s.area > 5 * nominalArea) { reject(s, 'large', info); continue; }
          if (peak < hi) { reject(s, 'faint', info); continue; }
          if (s.extent < (isSplit ? 0.55 : 0.6) || s.extent > (isSplit ? 0.97 : 0.93)) { reject(s, 'extent', info); continue; }
          if (s.aspect > 2.4) { reject(s, 'aspect', info); continue; }

          // Colour of the responding pixels vs. the ring around the blob.
          let r = 0, g = 0, b = 0, c = 0;
          for (const p of pix) if (M[p] >= lo) { r += d[p * 4]; g += d[p * 4 + 1]; b += d[p * 4 + 2]; c++; }
          const frac = c ? surroundDiff(img, s, [r / c, g / c, b / c], Math.max(18, 0.3 * peak)) : 0;
          info.surround = frac;
          info.coverage = c / s.area;
          const col = c ? [r / c, g / c, b / c] : [0, 0, 0];
          if (polarity === 'dark') {
            // The same colour again just beyond the ring: a gap between printed strokes.
            const outer = surroundDiff(img, s, col, Math.max(18, 0.3 * peak), [3.0, 3.6]);
            info.outer = outer;
            if (outer < 0.45) { reject(s, 'gap', info); continue; }
          }
          // Split pieces have neighbours in their ring, so ask for less.
          if (frac < (isSplit ? 0.65 : 0.7)) { reject(s, 'surround', info); continue; }
          blobs.push({ s, peak, polarity, frac, coverage: c / s.area, isSplit });
        }
      }
    }

    // Typical single-hole area: median of the round blobs when there are enough.
    const round = blobs.filter((bl) => bl.s.aspect < 1.3).map((bl) => bl.s.area);
    const single = round.length >= 3 ? Math.min(1.6 * nominalArea, Math.max(nominalArea, median(round))) : nominalArea;
    const candidates = [];
    for (const { s, peak, polarity, frac, coverage, isSplit } of blobs) {
      // Single holes are round once the photo is straightened. Overlapping BBs
      // make a hole that is both elongated and clearly bigger than one hole.
      let count;
      if (s.aspect <= (isSplit ? 1.5 : 1.25) && s.area <= 2.6 * single) {
        if (s.area < 0.6 * nominalArea) { reject(s, 'small-round', { polarity, area: s.area / nominalArea }); continue; }
        count = 1;
      } else if (s.area >= Math.max(1.8 * nominalArea, 1.5 * single)) {
        count = Math.max(2, Math.min(3, Math.round(s.area / single)));
      } else { reject(s, 'elongated', { polarity, aspect: s.aspect, area: s.area / nominalArea }); continue; }
      const dIn = 2 * Math.sqrt(s.area / count / Math.PI) / ppi;
      const ux = Math.cos(s.axisAng), uy = Math.sin(s.axisAng);
      for (let j = 0; j < count; j++) {
        const off = count === 1 ? 0 : (j - (count - 1) / 2) * (2 * s.a / count);
        candidates.push({
          xIn: (s.cx + ux * off) / ppi, yIn: (s.cy + uy * off) / ppi,
          dIn, count, contrast: peak, polarity, surround: frac, coverage,
          aspect: s.aspect, extent: s.extent, areaRatio: s.area / nominalArea,
        });
      }
    }

    // Drop candidates sitting inside a text band.
    const inBand = (c1) => textBands.some(({ s: b, polarity }) => {
      if (polarity !== c1.polarity) return false;
      const dx = c1.xIn * ppi - b.cx, dy = c1.yIn * ppi - b.cy;
      const u = dx * Math.cos(b.axisAng) + dy * Math.sin(b.axisAng);
      const v = -dx * Math.sin(b.axisAng) + dy * Math.cos(b.axisAng);
      return Math.abs(u) <= b.a + 0.05 * ppi && Math.abs(v) <= b.b + 0.05 * ppi;
    });
    const nonText = candidates.filter((c1) => {
      const t = inBand(c1);
      if (t && o.debug) o.debug.push({ xIn: c1.xIn, yIn: c1.yIn, reason: 'text', polarity: c1.polarity });
      return !t;
    });
    candidates.length = 0;
    candidates.push(...nonText);

    // Merge light/dark responses to the same hole; keep the stronger.
    candidates.sort((a, b2) => b2.contrast - a.contrast);
    const kept = [];
    const mergeR = 0.6 * o.holeDiamIn;
    for (const cnd of candidates) {
      if (kept.some((k2) => k2.polarity !== cnd.polarity && Math.hypot(k2.xIn - cnd.xIn, k2.yIn - cnd.yIn) < mergeR)) continue;
      kept.push(cnd);
    }
    // Drop printed features recorded from a blank target.
    const tR = Math.max(o.templateRadiusIn, 0.8 * o.holeDiamIn);
    return o.template && o.template.length
      ? kept.filter((cnd) => !o.template.some((t) => Math.hypot(t.xIn - cnd.xIn, t.yIn - cnd.yIn) < tR))
      : kept;
  }

  // ---------------------------------------------------------------------------
  // Group statistics
  // ---------------------------------------------------------------------------

  /**
   * points: [{x, y}] in inches, origin at the aim point, y up.
   * Returns statistics; all lengths in inches.
   */
  function analyze(points) {
    const n = points.length;
    if (!n) return { n: 0 };
    const mx = points.reduce((s, p) => s + p.x, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    let es = 0, esPair = null;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > es) { es = d; esPair = [i, j]; }
    }
    const radii = points.map((p) => Math.hypot(p.x - mx, p.y - my));
    const meanRadius = radii.reduce((s, r) => s + r, 0) / n;
    const sdx = n > 1 ? Math.sqrt(points.reduce((s, p) => s + (p.x - mx) ** 2, 0) / (n - 1)) : 0;
    const sdy = n > 1 ? Math.sqrt(points.reduce((s, p) => s + (p.y - my) ** 2, 0) / (n - 1)) : 0;
    const fromAim = points.map((p) => Math.hypot(p.x, p.y));
    let near = 0, far = 0;
    fromAim.forEach((d, i) => { if (d < fromAim[near]) near = i; if (d > fromAim[far]) far = i; });

    // Outliers: far from the median center relative to the median radius.
    const cxm = median(points.map((p) => p.x)), cym = median(points.map((p) => p.y));
    const rm = points.map((p) => Math.hypot(p.x - cxm, p.y - cym));
    const medR = median(rm);
    const outliers = [];
    if (n >= 5 && medR > 0) rm.forEach((r, i) => { if (r > 2.5 * medR && r > 0.5) outliers.push(i); });

    // Group size ignoring flyers, used to judge how far off-center the group is.
    let cleanES = es;
    if (outliers.length) {
      cleanES = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (outliers.includes(i) || outliers.includes(j)) continue;
        cleanES = Math.max(cleanES, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
      }
    }

    return {
      n,
      cleanExtremeSpread: cleanES,
      center: { x: mx, y: my },
      offset: Math.hypot(mx, my),
      clock: clockDirection(mx, my),
      extremeSpread: es,
      extremeSpreadPair: esPair,
      meanRadius,
      sdX: sdx,
      sdY: sdy,
      nearest: near,
      nearestDist: fromAim[near],
      furthest: far,
      furthestDist: fromAim[far],
      outliers,
    };
  }

  function clockDirection(x, y) {
    if (Math.hypot(x, y) < 1e-9) return null;
    let deg = Math.atan2(x, y) * 180 / Math.PI; // 0 = up, clockwise
    if (deg < 0) deg += 360;
    let hr = Math.round(deg / 30) % 12;
    return hr === 0 ? 12 : hr;
  }

  // ---------------------------------------------------------------------------
  // Airsoft feedback
  // ---------------------------------------------------------------------------

  /**
   * stats from analyze(); distanceFt optional.
   * Returns [{ title, detail }] tips, most important first.
   */
  function airsoftTips(stats, distanceFt) {
    const tips = [];
    if (!stats || stats.n === 0) return [{ title: 'No hits found', detail: 'Tap the target to add hits by hand, or retake the photo closer and straight on.' }];
    if (stats.n < 3) tips.push({ title: 'Shoot more for a reliable read', detail: 'Fewer than 3 hits says little about your group. 5 to 10 shots at the same aim point gives a much better picture.' });

    const spread = Math.max(stats.cleanExtremeSpread != null ? stats.cleanExtremeSpread : stats.extremeSpread, 0.5);
    // Only call out an offset that is meaningful compared with the group itself.
    const offThresh = Math.max(0.4, 0.15 * spread);
    const { x, y } = stats.center;
    const fmt = (v) => `${Math.abs(v).toFixed(1)} in`;

    if (y > offThresh) tips.push({ title: `Group is high (${fmt(y)})`, detail: 'Hop-up is probably set too strong: back it off a little and retest. Other causes: sights set too low (move the rear sight down) or a grip that pushes the muzzle up as you fire.' });
    if (y < -offThresh) tips.push({ title: `Group is low (${fmt(y)})`, detail: 'Add a little hop-up, or check that your BB weight suits your gun (a heavier BB needs more hop). Also check sights set too high (move the rear sight up), the muzzle dipping as you pull the trigger, or low or inconsistent FPS. At longer distances BB drop is a bigger factor.' });
    if (x > offThresh) tips.push({ title: `Group is right (${fmt(x)})`, detail: 'Check the hop-up bucking and nub are seated evenly: uneven hop curves BBs sideways. Also check windage (move the rear sight left), trigger finger placement, and canting the gun to one side.' });
    if (x < -offThresh) tips.push({ title: `Group is left (${fmt(x)})`, detail: 'Check the hop-up bucking and nub are seated evenly: uneven hop curves BBs sideways. Also check windage (move the rear sight right), trigger finger placement, and canting the gun to one side.' });

    if (stats.n >= 3) {
      if (stats.sdY > 1.8 * stats.sdX && stats.sdY > 0.4) tips.push({ title: 'Vertical stringing', detail: 'Shots spread up and down more than side to side. Common airsoft causes: inconsistent FPS (check the air seal and battery or gas), mixed or poor-quality BBs, a hop-up that is borderline too strong, or breathing during the shot.' });
      else if (stats.sdX > 1.8 * stats.sdY && stats.sdX > 0.4) tips.push({ title: 'Horizontal stringing', detail: 'Shots spread side to side. Look at wind, canting the gun, an uneven hop-up bucking, or a dirty inner barrel.' });

      let verdict;
      if (distanceFt && distanceFt > 0) {
        const per10 = stats.extremeSpread / (distanceFt / 10);
        if (per10 < 0.6) verdict = ['Tight group', 'Very consistent for airsoft at this distance. Focus on moving the group onto your aim point.'];
        else if (per10 < 1.2) verdict = ['Solid group', 'Good consistency. Quality, seamless BBs and a clean barrel can tighten it further.'];
        else if (per10 < 2.5) verdict = ['Group could be tighter', 'Use good quality BBs of one weight (0.25 g or heavier for most AEGs), clean the inner barrel, and work on a steady hold and smooth trigger pull.'];
        else verdict = ['Wide group', 'Start with the basics: a clean barrel, consistent BBs, and a hop-up set just enough to keep BBs flat. If it stays wide, check the hop-up bucking for wear.'];
        verdict[1] += ` (Group size is ${stats.extremeSpread.toFixed(1)} in at ${distanceFt} ft. These thresholds are rough guides.)`;
      } else {
        verdict = ['Group size', `Your group is ${stats.extremeSpread.toFixed(1)} in across. Enter your shooting distance to get a judgment on it.`];
      }
      tips.push({ title: verdict[0], detail: verdict[1] });
    }
    if (stats.outliers && stats.outliers.length) tips.push({ title: `${stats.outliers.length} flyer${stats.outliers.length > 1 ? 's' : ''}`, detail: 'One or more shots landed well away from the rest. Flyers in airsoft are often a bad BB (seam or dent) or a flinch. The stats show the group with and without them.' });
    if (Math.abs(x) <= offThresh && Math.abs(y) <= offThresh && stats.n >= 3) tips.unshift({ title: 'Centered on your aim point', detail: 'The group center is close to where you aimed. No sight or hop-up change needed for point of impact.' });
    return tips;
  }

  return {
    grayFromRGBA, resizeArea, boxBlur, erode, dilate,
    homography, applyH, polygonArea, isConvexQuad,
    findPaperQuad, warpToPaper, suggestPpi, detectHoles,
    analyze, clockDirection, airsoftTips, DEFAULT_DETECT,
  };
});
