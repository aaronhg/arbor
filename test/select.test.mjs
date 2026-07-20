// Phase-3 safety net: affectedData (moved out of copse's `affected` verb) picks the frozen flow tests a
// change touches. Locks the selection so gate's PR scoping stays correct after the move off copse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectedData, drivenPaths } from '../src/select.mjs';

test('drivenPaths collects press refs, get/call sels (path before :Comp.member), and cc.find in evals', () => {
  const script = { steps: [
    { op: 'press', ref: 'Canvas/AttackBtn' },
    { op: 'get', sel: 'Canvas/Game:DungeonGame.hp' },       // → Canvas/Game
    { op: 'eval', expr: "cc.find('Canvas/MenuPanel').active" }, // → Canvas/MenuPanel
    { op: 'sleep', ms: 500 },                                // no path
  ] };
  assert.deepEqual(drivenPaths(script).sort(), ['Canvas/AttackBtn', 'Canvas/Game', 'Canvas/MenuPanel']);
});

test('a test is affected iff a driven path tail-matches an impacted button (coir scene-root prefix absorbed)', () => {
  const risk = { impactedButtons: [{ nodePath: 'home/Canvas/AttackBtn' }], impactedScenes: [] };
  const tests = [
    { name: 'combat.json', script: { steps: [{ op: 'press', ref: 'Canvas/AttackBtn' }] } },   // hits
    { name: 'menu.json', script: { steps: [{ op: 'press', ref: 'Canvas/MenuBtn' }] } },        // misses
  ];
  const r = affectedData(risk, tests);
  assert.deepEqual(r.affected.map((a) => a.name), ['combat.json']);
  assert.deepEqual(r.affected[0].hits, ['Canvas/AttackBtn']);
  assert.deepEqual(r.skipped, ['menu.json']);
  assert.equal(r.sceneOnly, false);
});

test('a scene-only impact (no specific buttons) keeps ALL tests — can\'t be narrowed', () => {
  const risk = { impactedButtons: [], impactedScenes: [{ file: 'main.scene' }] };
  const tests = [{ name: 'a.json', script: { steps: [{ op: 'press', ref: 'X' }] } }];
  const r = affectedData(risk, tests);
  assert.equal(r.sceneOnly, true);
  assert.deepEqual(r.affected.map((a) => a.name), ['a.json']);
  assert.deepEqual(r.affected[0].hits, ['(scene changed — all kept)']);
});

test('#7 a MIXED impact (impactedScenes AND specific buttons) keeps ALL tests — the scene net wins', () => {
  // Real coir output carries the host scene for a code impact; a scene can be affected beyond the buttons
  // whose handlers changed, so keep-all is the safe resolution (narrowing risks missing a cross-flow effect).
  const risk = { impactedButtons: [{ nodePath: 'home/Canvas/AttackBtn' }], impactedScenes: [{ path: 'scene/main.scene' }] };
  const tests = [
    { name: 'combat.json', script: { steps: [{ op: 'press', ref: 'Canvas/AttackBtn' }] } },
    { name: 'unrelated.json', script: { steps: [{ op: 'press', ref: 'Canvas/NopeBtn' }] } },
  ];
  const r = affectedData(risk, tests);
  assert.equal(r.sceneOnly, true);
  assert.deepEqual(r.affected.map((a) => a.name).sort(), ['combat.json', 'unrelated.json']); // both kept
  assert.deepEqual(r.skipped, []);
});

test('the button-narrow path: buttons impacted with NO scene → narrows to the tests that touch them', () => {
  // the only case narrowing fires — a finer impact (e.g. a prefab-internal handler) with impactedScenes empty.
  const risk = { impactedButtons: [{ nodePath: 'home/Canvas/AttackBtn' }], impactedScenes: [] };
  const tests = [
    { name: 'combat.json', script: { steps: [{ op: 'press', ref: 'Canvas/AttackBtn' }] } },
    { name: 'unrelated.json', script: { steps: [{ op: 'press', ref: 'Canvas/NopeBtn' }] } },
  ];
  const r = affectedData(risk, tests);
  assert.equal(r.sceneOnly, false);
  assert.deepEqual(r.affected.map((a) => a.name), ['combat.json']);
  assert.deepEqual(r.skipped, ['unrelated.json']);
});

test('an empty risk set (nothing impacted) skips everything', () => {
  const r = affectedData({ impactedButtons: [], impactedScenes: [] }, [{ name: 'a.json', script: { steps: [{ op: 'press', ref: 'X' }] } }]);
  assert.deepEqual(r.affected, []);
  assert.deepEqual(r.skipped, ['a.json']);
});
