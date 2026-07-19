// Phase-0 safety net: recordEval handles BOTH shapes it must serve — outcome-judged runs (result.score)
// and calibrate runs (result.stableCount/scenarios) — and skips when there's nothing scorable. A prior
// code-review bug was calibrate never recording; these pin both branches before the AI-loop phases move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEval } from '../src/evalstore.mjs';

const freshStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbor-eval-'));
  return { _dir: dir, evalStore: './evals.jsonl', file: join(dir, 'evals.jsonl') };
};
const lines = (file) => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

test('outcome-judged run (score) is recorded with detection_rate from the score', () => {
  const c = freshStore();
  recordEval(c, { mode: 'verify', model: 'm', score: { detection_rate: 3, total: 4, evidence_quality: 2, false_positives: 1, missed: ['bug-D'] } });
  const [e] = lines(c.file);
  assert.equal(e.mode, 'verify');
  assert.equal(e.detection_rate, 3);
  assert.equal(e.total, 4);
  assert.equal(e.evidence_quality, 2);
  assert.deepEqual(e.missed, ['bug-D']);
});

test('calibrate run (stableCount/scenarios) is recorded — the branch a prior bug skipped', () => {
  const c = freshStore();
  recordEval(c, { mode: 'calibrate', stableCount: 2, flakyCount: 1,
    scenarios: [{ id: 'a', stable: true }, { id: 'b', stable: true }, { id: 'c', stable: false }] });
  const [e] = lines(c.file);
  assert.equal(e.mode, 'calibrate');
  assert.equal(e.detection_rate, 2);          // = stableCount
  assert.equal(e.total, 3);                    // = scenarios.length
  assert.equal(e.false_positives, 1);          // = flakyCount
  assert.deepEqual(e.missed, ['c']);           // the unstable scenario
});

test('a judge error (score.error) records nothing', () => {
  const c = freshStore();
  recordEval(c, { mode: 'verify', score: { error: 'judge failed' } });
  assert.equal(lines(c.file).length, 0);
});

test('nothing scorable (no score, no stableCount) records nothing', () => {
  const c = freshStore();
  recordEval(c, { mode: 'explore', findings: [{ symptom: 'x' }] });
  assert.equal(lines(c.file).length, 0);
});

test('a second same-mode entry appends (trend is preserved, not overwritten)', () => {
  const c = freshStore();
  recordEval(c, { mode: 'verify', score: { detection_rate: 2, total: 4, evidence_quality: 1, false_positives: 0, missed: [] } });
  recordEval(c, { mode: 'verify', score: { detection_rate: 4, total: 4, evidence_quality: 3, false_positives: 0, missed: [] } });
  const es = lines(c.file);
  assert.equal(es.length, 2);
  assert.equal(es[1].detection_rate, 4);       // newest last → an append-only trend
});
