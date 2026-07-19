// Phase-0 safety net: the coverage gate's two pure halves — reduce() (copse coverage buckets → findings +
// coveredIds) and diffBaseline() (the certified-can-go-red diff). Phase 4 moves the join into arbor and
// deletes copse's coverage verb; these lock the verdict logic so that move can't silently change a PR's pass/fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffBaseline, reduce } from '../src/modes/coverage.mjs';

// a copse-coverage-shaped object: every bucket keyed by nodePath::method
const cov = {
  covered:   [{ nodePath: 'Canvas/Play', method: 'play' }, { nodePath: 'Canvas/Menu', method: 'open' }],
  blocked:   [{ nodePath: 'Canvas/Buy', method: 'buy', runtime: { blockedBy: 'Modal' } }],
  ambiguous: [{ nodePath: 'Canvas/X', method: 'x', reason: 'two handlers' }],
  uncertain: [{ nodePath: 'Canvas/Y', method: null }],
  codeOnly:  [{ nodePath: 'Canvas/Dead', method: 'dead' }],
  unreached: [],
};

test('reduce: buckets → sorted findings + coveredIds', () => {
  const { findings, coveredIds } = reduce(cov);
  // one finding per non-covered bucket, tagged with its kind
  assert.deepEqual(findings.map((f) => f.kind).sort(),
    ['ambiguous', 'dead-button', 'uncertain', 'wired-but-unreachable']);
  const blocked = findings.find((f) => f.kind === 'wired-but-unreachable');
  assert.equal(blocked.id, 'Canvas/Buy::buy');
  assert.equal(blocked.blockedBy, 'Modal');           // blockedBy carried through for the report
  // uncertain's null method serialises as the literal 'null' in the id (stable key)
  assert.ok(coveredIds.includes('Canvas/Play::play'));
  assert.deepEqual(coveredIds, [...coveredIds].sort()); // sorted → stable baseline diff
});

test('diffBaseline: green when identical to baseline', () => {
  const { findings, coveredIds } = reduce(cov);
  const base = { findings, coveredIds };
  const d = diffBaseline(base, findings, coveredIds);
  assert.equal(d.failed, false);
  assert.equal(d.newFindings.length, 0);
  assert.equal(d.regressed.length, 0);
});

test('diffBaseline: a NEW finding not in the baseline goes red', () => {
  const { findings, coveredIds } = reduce(cov);
  const base = { findings: findings.filter((f) => f.kind !== 'dead-button'), coveredIds };
  const d = diffBaseline(base, findings, coveredIds);
  assert.equal(d.failed, true);
  assert.equal(d.newFindings.length, 1);
  assert.equal(d.newFindings[0].kind, 'dead-button'); // the freshly-appeared dead button
});

test('diffBaseline: a covered button going unreachable (regression) goes red', () => {
  const { findings, coveredIds } = reduce(cov);
  const base = { findings, coveredIds: [...coveredIds, 'Canvas/Ghost::ghost'] }; // baseline had one more covered
  const d = diffBaseline(base, findings, coveredIds);
  assert.equal(d.failed, true);
  assert.deepEqual(d.regressed, ['Canvas/Ghost::ghost']); // it's now unreachable → regression
  assert.equal(d.newFindings.length, 0);
});
