// The VETO — arbor's whole reason to exist (copse reports facts; arbor decides what they mean). The
// boundary refactor moved this out of copse's runHarness and DELETED copse's ~15 gate/verdict tests
// without replacement, and a code review then found the veto had silently rotted in four ways, every one
// a FALSE NEGATIVE (a broken game reported green — the one thing this tool must never do). These pin the
// fixes so the invariants can't rot again. Pure over synthetic {rounds, facts} — no browser, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, compactSteps, USAGE_ERR, aggregate } from '../src/harness.mjs';
import { factsGate } from '../src/modes/impact.mjs';

// a runLoop-shaped result: five fact buckets + a rounds list (default: one clean 'ok' round)
const out = (facts = {}, rounds = [{ verdict: { verdict: 'ok' } }]) =>
  ({ rounds, facts: { errored: [], undriven: [], unreachable: [], uncertain: [], visual: [], ...facts } });
const sc = (kind = 'semantic') => ({ id: 's1', bug: 'B', kind });

// ── #1 · the structural veto is UNCONDITIONAL (was gated on kind==='gate', dropping the fact silently) ──
test('#1 classify: an undriven (dead-button) fact DETECTS in a semantic scenario, not just kind:gate', () => {
  const r = classify(out({ undriven: [{ ref: 'Canvas/AttackBtn' }] }), sc('semantic'));
  assert.equal(r.detected, true);
  assert.equal(r.by, 'gate');
  assert.match(r.reason, /Canvas\/AttackBtn: dead button/);
});

test('#1 classify: an unreachable fact DETECTS in a semantic scenario', () => {
  const r = classify(out({ unreachable: [{ ref: 'Canvas/BuyBtn', blockedBy: 'Canvas/Modal' }] }), sc('semantic'));
  assert.equal(r.detected, true);
  assert.match(r.reason, /unreachable \(blocked by Canvas\/Modal\)/);
});

// ── #2 · a REAL game crash must detect; only copse's OWN grammar rejections are inconclusive ──
test('#2 classify: a real null-deref in facts.errored is DETECTED (not downgraded to inconclusive)', () => {
  const r = classify(out({ errored: [{ ref: 'Canvas/AttackBtn', error: "TypeError: Cannot read properties of undefined (reading 'hp')" }] }), sc('semantic'));
  assert.equal(r.detected, true);
  assert.equal(r.by, 'gate');
});

test("#2 classify: a copse grammar rejection (the agent's own malformed selector) is INCONCLUSIVE", () => {
  const r = classify(out({ errored: [{ ref: 'x', error: "selector needs ':Comp.member' — got \"bad\"" }] }), sc('semantic'));
  assert.equal(r.detected, false);
  assert.equal(r.by, 'inconclusive');
});

test('#2 USAGE_ERR: matches copse grammar, NEVER generic JS crash text', () => {
  for (const usage of ["selector needs ':Comp.member'", 'no-component', 'bad-selector', 'unresolved']) {
    assert.ok(USAGE_ERR.test(usage), `should match copse usage: ${usage}`);
  }
  for (const crash of ["Cannot read properties of undefined (reading 'x')", 'this.hero.reset is not a function']) {
    assert.equal(USAGE_ERR.test(crash), false, `must NOT match real crash: ${crash}`);
  }
});

// baseline verdicts (so the fixes above didn't break the normal paths)
test('classify: judge "bug" → detected by judge; a clean run → not detected / "no issue found"', () => {
  const bug = classify(out({}, [{ verdict: { verdict: 'bug', reason: 'tally never reset' } }]), sc());
  assert.equal(bug.detected, true);
  assert.equal(bug.by, 'judge');
  const clean = classify(out(), sc());
  assert.equal(clean.detected, false);
  assert.equal(clean.reason, 'no issue found');
});

// ── #3 · compactSteps must not erase the judge's evidence ──
test('#3 compactSteps: a get returning value:null shows as null, NOT the string "ok"', () => {
  const [g] = compactSteps([{ step: { op: 'get', sel: 'Canvas/HpLabel:Label.string' }, result: { ok: true, value: null } }]);
  assert.equal(g.result, null);
});

test('#3 compactSteps: a drove-nothing press surfaces drove + wired (was flattened to "ok")', () => {
  const [p] = compactSteps([{ step: { op: 'press', ref: 'Canvas/DeadBtn' }, result: { ok: true, fired: 0, drove: 'nothing', wired: false } }]);
  assert.equal(p.drove, 'nothing');
  assert.equal(p.wired, false);
});

test('#3 compactSteps: engine-swallowed errors surface; healthy reads/presses are unchanged', () => {
  const [g, p, e] = compactSteps([
    { step: { op: 'get', sel: 'A:B.c' }, result: { ok: true, value: 70 } },
    { step: { op: 'press', ref: 'X' }, result: { ok: true, drove: ['clickEvent'] } },
    { step: { op: 'press', ref: 'Y' }, result: { ok: true, drove: ['clickEvent'], errors: [{ text: 'TypeError: boom' }] } },
  ]);
  assert.equal(g.result, 70);           // value passthrough
  assert.equal(p.result, 'ok');         // healthy press
  assert.deepEqual(e.errors, ['TypeError: boom']);
});

// ── #4 · impact's gate reads facts.* (was out.*, making the whole gate dead code) ──
test('#4 factsGate: builds items from facts.*, filtering the agent\'s own usage errors', () => {
  const g = factsGate({
    undriven: [{ ref: 'A' }],
    unreachable: [{ ref: 'B', blockedBy: 'M' }],
    errored: [{ ref: 'C', error: 'TypeError: Cannot read x' }, { ref: 'd', error: 'selector needs :Comp.member' }],
  });
  assert.deepEqual(g.map((x) => x.ref).sort(), ['A', 'B', 'C']); // usage error 'd' filtered out
});

test('#4 factsGate: empty / undefined facts → no items (never throws)', () => {
  assert.deepEqual(factsGate({}), []);
  assert.deepEqual(factsGate(undefined), []);
});

// ── #5 · the uncertain / visual SOFT signals must reach the finding (copse pays screenshots for them) ──
test('#5 classify: uncertain + visual surface in reason + as fields — never a hard detection, never dropped', () => {
  const r = classify(out({
    uncertain: [{ ref: 'Canvas/MaybeDead', why: 'touch-into-void' }],
    visual: [{ press: 'X', node: 'Canvas/Panel', reason: 'blank' }],
  }), sc('semantic'));
  assert.equal(r.detected, false);                       // soft — fail-loud, not fail
  assert.match(r.reason, /^verify:/);                    // NOT 'no issue found'
  assert.match(r.reason, /touch-into-void/);
  assert.match(r.reason, /Canvas\/Panel: shown but not drawn/);
  assert.deepEqual(r.uncertain, [{ ref: 'Canvas/MaybeDead', why: 'touch-into-void' }]);
  assert.equal(r.visual.length, 1);
});

// ── #8 · aggregate uses a STRICT majority; even N no longer certifies a 50% detector as stable ──
test('#8 aggregate: even N — 1/2 is flaky (not stable), 2/2 stable; 2/4 flaky, 3/4 stable', () => {
  const runs = (dets, n) => Array.from({ length: n }, (_, i) => ({ id: 's', bug: 'B', kind: 'gate', detected: i < dets, reason: 'r', by: 'gate' }));
  const s = (dets, n) => aggregate(runs(dets, n)).scenarios[0];
  assert.equal(s(1, 2).stable, false);  assert.equal(s(1, 2).flaky, true);
  assert.equal(s(2, 2).stable, true);
  assert.equal(s(2, 4).stable, false);  assert.equal(s(2, 4).flaky, true);
  assert.equal(s(3, 4).stable, true);
});

test('#8 aggregate: odd N unchanged — 2/3 stable, 1/3 flaky (floor(N/2)+1 === ceil(N/2) for odd N)', () => {
  const runs = (dets, n) => Array.from({ length: n }, (_, i) => ({ id: 's', bug: 'B', kind: 'gate', detected: i < dets, reason: 'r', by: 'gate' }));
  assert.equal(aggregate(runs(2, 3)).scenarios[0].stable, true);
  assert.equal(aggregate(runs(1, 3)).scenarios[0].flaky, true);
});
