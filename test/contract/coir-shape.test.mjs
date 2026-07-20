// Consumer-driven CONTRACT test for the coir → arbor seam (cross-process stdout JSON). It asserts arbor's
// ACTUAL consumers (coverageJoin, affectedData) work against coir's REAL output — captured goldens in
// fixtures/ (regenerate with capture.mjs), NOT hand-written shapes. This is where a coir field rename gets
// caught (e.g. clickmap's `component`, which the crafted unit fixtures wrongly called `handlerClass`).
//
// Two layers:
//   1. GOLDEN — always runs, hermetic. Feed the committed real coir output through arbor's consumers.
//   2. LIVE   — runs only when coir is reachable (env COIR_CLI or an adjacent ../coir + demo). Re-run coir
//      and assert the live output STILL carries the field set arbor depends on. coir's CI re-runs THIS
//      (clone arbor, set COIR_CLI) so a coir shape change reddens coir's own build, not arbor's someday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { coverageJoin } from '../../src/join.mjs';
import { affectedData } from '../../src/select.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = (f) => JSON.parse(readFileSync(join(HERE, 'fixtures', f), 'utf8'));
const clickmap = golden('coir-clickmap.json');
const impact = golden('coir-impact.json');

// ---- 1. GOLDEN: arbor consumes coir's REAL shape (hermetic) --------------------------------------
test('coir clickmap golden: every row carries the (nodePath, method) join key arbor needs', () => {
  assert.ok(Array.isArray(clickmap) && clickmap.length > 0, 'clickmap -o json is a non-empty array');
  for (const r of clickmap) {
    assert.equal(typeof r.nodePath, 'string', 'every row has a nodePath (the join key)');
    assert.ok('method' in r, 'every row has method (string | null — the other half of the key)');
  }
});

test('coir clickmap golden joins through coverageJoin — real coir nodePaths, scene-root prefix and all', () => {
  // Build the copse runtime half FROM the golden: strip coir's scene-root segment (`fixture/…` → `Canvas/…`,
  // what a copse ref actually looks like), so this exercises the SAME cross-rooting the real gate hits.
  const surface = clickmap.map((r) => ({ ref: r.nodePath.split('/').slice(1).join('/'), method: r.method, interactable: true, reachable: true }));
  const { covered, ambiguous, codeOnly } = coverageJoin(clickmap, surface);
  assert.equal(covered.length, clickmap.length, 'every real coir row joins to its live button via the scene-root tail-match');
  assert.equal(ambiguous.length, 0);
  assert.equal(codeOnly.length, 0, 'nothing leaks — the join keyed on the real (nodePath, method)');
  assert.equal(covered[0].via, 'prefix');
  assert.equal(covered[0].dropped, 'fixture', "coir's scene-file root is the `dropped` head");
});

test('coir impact golden: schema + the fields affectedData keys on', () => {
  assert.equal(impact.schema, 1, 'impact -o json carries the contract version (schema:1)');
  assert.ok(Array.isArray(impact.impactedButtons), 'impactedButtons is an array');
  assert.ok(Array.isArray(impact.impactedScenes), 'impactedScenes is an array');
  for (const b of impact.impactedButtons) assert.equal(typeof b.nodePath, 'string', 'each impacted button has a nodePath');
});

test('coir impact golden selects through affectedData — a real script change impacts a SCENE → keep ALL', () => {
  // A REAL coir impact of a script edit carries an impactedScene (the script is used by the scene), so the
  // "scene net wins": affectedData can't narrow, it keeps every test. (The button-narrowing path only fires
  // for a finer impact with NO scene — a case the crafted select.test.mjs fixtures cover; this locks the
  // path REAL coir output actually takes, which those hand-written fixtures never hit.)
  assert.ok(impact.impactedScenes.length > 0, 'the golden impact carries an impacted scene (a script change does)');
  const tests = [
    { name: 'combat.json', script: { steps: [{ op: 'press', ref: 'Canvas/AttackBtn' }] } },
    { name: 'unrelated.json', script: { steps: [{ op: 'press', ref: 'Canvas/NopeBtn' }] } },
  ];
  const r = affectedData(impact, tests);
  assert.equal(r.sceneOnly, true, 'a real impacted scene keeps all tests (no false narrowing)');
  assert.deepEqual(r.affected.map((a) => a.name).sort(), ['combat.json', 'unrelated.json']);
  assert.deepEqual(r.skipped, []);
});

// ---- 2. LIVE: re-run coir, assert the live output STILL carries arbor's field set (drift catch) ----
const LIVE_COIR = process.env.COIR_CLI || (existsSync(resolve(HERE, '../../../coir/src/cli.js')) ? resolve(HERE, '../../../coir/src/cli.js') : null);
const LIVE_PROJ = process.env.CONTRACT_PROJECT || (existsSync(resolve(HERE, '../../../coir-copse-demo')) ? resolve(HERE, '../../../coir-copse-demo') : null);
const liveSkip = (LIVE_COIR && LIVE_PROJ) ? false : 'coir + a project not reachable (set COIR_CLI / CONTRACT_PROJECT, or sibling ../coir + ../coir-copse-demo)';
const runCoir = (args) => JSON.parse(execFileSync('node', [LIVE_COIR, '-C', LIVE_PROJ, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }));

test('LIVE coir clickmap still emits the golden field set (catches a coir-side shape change)', { skip: liveSkip }, () => {
  const rows = runCoir(['clickmap', 'scene/fixture.scene', '-o', 'json']);
  assert.ok(Array.isArray(rows) && rows.length, 'live clickmap is a non-empty array');
  const keys = new Set(Object.keys(rows[0]));
  for (const k of ['nodePath', 'method', 'component']) {
    assert.ok(keys.has(k), `live clickmap row lost '${k}' — coir changed its shape; run capture.mjs + reconcile arbor`);
  }
});

test('LIVE coir impact still emits schema + the golden field set', { skip: liveSkip }, () => {
  const d = runCoir(['impact', 'assets/scripts/DungeonGame.ts', '-o', 'json']);
  assert.equal(d.schema, 1, 'live impact carries schema:1 — a bump means a breaking shape change arbor must adopt');
  assert.ok(Array.isArray(d.impactedButtons) && d.impactedButtons.every((b) => typeof b.nodePath === 'string'));
  assert.ok(Array.isArray(d.impactedScenes));
});
