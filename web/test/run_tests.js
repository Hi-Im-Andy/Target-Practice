#!/usr/bin/env node
/*
 * Detection accuracy harness.
 *
 *   python3 tools/make_synthetic.py     # once, writes web/test/data/
 *   node web/test/run_tests.js [--corners truth|auto] [--verbose] [--dump]
 *
 * For each synthetic image it straightens the paper (with the hand-labelled
 * corners by default, or the auto-detected ones), detects holes, and matches
 * detections to the true hole positions. Reports recall, false positives and
 * position error in inches, plus false positives on the blank photos.
 * Also runs unit checks on the statistics.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TP = require('../tp-core.js');

const args = process.argv.slice(2);
const cornerMode = args.includes('--corners') ? args[args.indexOf('--corners') + 1] : 'truth';
const verbose = args.includes('--verbose');
const dump = args.includes('--dump');
const useTemplate = args.includes('--template'); // learn printed marks from a blank photo of another shot
const DATA = path.join(__dirname, 'data');
const MATCH_TOL_IN = 0.2; // a detection within this distance of a true hole counts

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.log('  FAIL', msg); } else if (verbose) console.log('  ok  ', msg);
}

// ---------------------------------------------------------------- unit checks
function unitChecks() {
  console.log('Unit checks');
  const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 4 }];
  const s = TP.analyze(pts);
  check(Math.abs(s.center.x - 1) < 1e-9 && Math.abs(s.center.y - 8 / 3) < 1e-9, 'mean point of impact');
  check(Math.abs(s.extremeSpread - 5) < 1e-9, 'extreme spread is the widest pair (5)');
  check(s.nearest === 0 && s.furthest === 1, 'nearest / furthest from aim point');
  check(TP.clockDirection(0, 1) === 12 && TP.clockDirection(1, 0) === 3 && TP.clockDirection(0, -1) === 6, 'clock directions');
  // Old Python bug: max dx and max dy from different pairs. (0,0),(1,0),(0,1): ES = sqrt(2) here either way,
  // but (0,0),(2,0),(2,0.1),(0,2): max dx=2,max dy=2 -> 2.83, true ES = 2.83 between (2,0)/(0,2)... use a clearer case:
  const t = TP.analyze([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1.9 }]);
  check(Math.abs(t.extremeSpread - 2.147) < 0.01, 'extreme spread not inflated by mixing pairs');
  const many = [];
  for (let i = 0; i < 8; i++) many.push({ x: Math.cos(i) * 0.4, y: Math.sin(i) * 0.4 });
  many.push({ x: 5, y: 5 });
  check(TP.analyze(many).outliers.length === 1 && TP.analyze(many).outliers[0] === 8, 'flyer flagged as outlier');
  const H = TP.homography([[0, 0], [10, 0], [10, 20], [0, 20]], [[5, 7], [105, 12], [110, 220], [2, 210]]);
  const p = TP.applyH(H, 10, 20);
  check(Math.abs(p[0] - 110) < 1e-6 && Math.abs(p[1] - 220) < 1e-6, 'homography maps corners');
  const tips = TP.airsoftTips(TP.analyze([{ x: 0.2, y: 3 }, { x: -0.2, y: 3.3 }, { x: 0, y: 2.8 }]), 30);
  check(tips.some((tp) => /high/i.test(tp.title)), 'tips: high group -> "high" tip');
  // A flyer must not hide a clearly high group behind "centered".
  const fl = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 0.3 * Math.cos(i), y: 2.3 + 0.3 * Math.sin(i) }));
  fl.push({ x: 8, y: -9 });
  const t2 = TP.airsoftTips(TP.analyze(fl), 30);
  check(!t2.some((tp) => /Centered/.test(tp.title)) && t2.some((tp) => /high/i.test(tp.title)), 'tips: flyer does not mask a high group');
}

// ------------------------------------------------------------- detection set
function loadImage(entry) {
  const data = new Uint8ClampedArray(fs.readFileSync(path.join(DATA, entry.file + '.rgba')));
  return { width: entry.width, height: entry.height, data };
}

function run() {
  const manifestPath = path.join(DATA, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('No synthetic data. Run: python3 tools/make_synthetic.py');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const [pw, ph] = manifest.paper_in;
  const hole = manifest.bb_diam_in;
  console.log(`\nDetection (corners: ${cornerMode}${useTemplate ? ', with blank-target template from another photo' : ''})`);
  let tp = 0, fn = 0, fp = 0, blankFp = 0, errSum = 0, ms = 0, nImg = 0;
  const missedByBg = {};
  const rows = [];

  // Printed-mark templates: what each blank photo detects (paper inches).
  const templates = {};
  if (useTemplate) {
    for (const e of manifest.images.filter((x) => !x.holes.length)) {
      const img = loadImage(e);
      const warp = TP.warpToPaper(img, e.corners, pw, ph, TP.suggestPpi(hole, pw, ph));
      templates[e.photo] = TP.detectHoles(warp, { holeDiamIn: hole }).map((hh) => ({ xIn: hh.xIn, yIn: hh.yIn }));
    }
  }
  const photos = [...new Set(manifest.images.map((x) => x.photo))];

  for (const e of manifest.images) {
    const img = loadImage(e);
    const t0 = Date.now();
    const corners = cornerMode === 'auto' ? TP.findPaperQuad(img).corners : e.corners;
    const ppi = TP.suggestPpi(hole, pw, ph);
    const warp = TP.warpToPaper(img, corners, pw, ph, ppi);
    const debug = [];
    // Template from the NEXT photo's blank (a different picture of the same target).
    const template = useTemplate ? templates[photos[(photos.indexOf(e.photo) + 1) % photos.length]] : null;
    const hits = TP.detectHoles(warp, { holeDiamIn: hole, debug, template });
    ms += Date.now() - t0; nImg++;

    // Detections -> image px -> true paper inches (so auto-corner errors count).
    const Htrue = TP.homography(e.corners, [[0, 0], [pw, 0], [pw, ph], [0, ph]]);
    const det = hits.map((hh) => {
      const [u, v] = TP.applyH(warp.Hp2i, hh.xIn, hh.yIn);
      const [x, y] = TP.applyH(Htrue, u, v);
      return { x, y, px: [u, v], h: hh };
    });

    if (dump) {
      fs.writeFileSync(path.join(DATA, e.file + '.det.json'), JSON.stringify({ corners, det: det.map((d) => ({ px: d.px, polarity: d.h.polarity, count: d.h.count, contrast: d.h.contrast })) }));
    }

    if (!e.holes.length) {
      blankFp += det.length;
      rows.push(`${e.file.padEnd(28)} blank   false hits: ${det.length}`);
      continue;
    }
    // Greedy matching, closest pairs first.
    const pairs = [];
    det.forEach((d, i) => e.holes.forEach((t, j) => {
      const dist = Math.hypot(d.x - t.xIn, d.y - t.yIn);
      if (dist < MATCH_TOL_IN) pairs.push([dist, i, j]);
    }));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedD = new Set(), usedT = new Set();
    let err = 0, m = 0;
    for (const [dist, i, j] of pairs) {
      if (usedD.has(i) || usedT.has(j)) continue;
      usedD.add(i); usedT.add(j); err += dist; m++;
    }
    const miss = e.holes.length - m, extra = det.length - m;
    e.holes.forEach((t, j) => { if (!usedT.has(j)) missedByBg[t.bg] = (missedByBg[t.bg] || 0) + 1; });
    tp += m; fn += miss; fp += extra; errSum += err;
    rows.push(`${e.file.padEnd(28)} found ${String(m).padStart(2)}/${e.holes.length}  extra ${extra}  err ${(m ? err / m : 0).toFixed(3)} in`);
    if (verbose) {
      det.forEach((d, i) => { if (!usedD.has(i)) console.log('    extra at px', d.px.map(Math.round), d.h.polarity, 'c=' + d.h.contrast.toFixed(0)); });
      e.holes.forEach((t, j) => {
        if (usedT.has(j)) return;
        // Map the truth into the warp's paper coords to look up why it was rejected.
        const [u, v] = TP.applyH(warp.Hi2p, t.px[0], t.px[1]);
        const why = debug.filter((r) => Math.hypot(r.xIn - u, r.yIn - v) < 0.3)
          .map((r) => `${r.reason}(${Object.entries(r).filter(([k2]) => !['xIn', 'yIn', 'reason'].includes(k2)).map(([k2, v2]) => k2 + '=' + (typeof v2 === 'number' ? v2.toFixed(2) : v2)).join(' ')})`);
        console.log('    missed at px', t.px.map(Math.round), t.bg, why.join('; ') || 'no blob');
      });
    }
  }
  rows.forEach((r) => console.log('  ' + r));
  const recall = tp / (tp + fn);
  console.log(`\n  Recall ${(100 * recall).toFixed(1)}% (${tp}/${tp + fn})  extra hits ${fp}  blank-photo false hits ${blankFp}`);
  console.log(`  Mean position error ${(errSum / Math.max(1, tp)).toFixed(3)} in   avg time ${(ms / nImg).toFixed(0)} ms/image`);
  if (Object.keys(missedByBg).length) console.log('  Missed by background:', JSON.stringify(missedByBg));
  return { recall, fp, blankFp };
}

unitChecks();
const res = run();
if (res && cornerMode === 'truth' && !useTemplate) {
  check(res.recall >= 0.85, `recall >= 85% (got ${(100 * res.recall).toFixed(1)}%)`);
  check(res.fp <= 60, `<= ~6.5 extra hits per image (printed marks) (got ${res.fp})`);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
