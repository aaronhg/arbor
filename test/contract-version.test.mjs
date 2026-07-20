// The runtime compatibility guards (src/contract.mjs). These matter more than they look: arbor resolves
// copse/coir from a PATH, so nothing in npm's resolution checks that the three agree — if these assertions
// are wrong or absent, an incompatible sibling doesn't crash, it quietly produces a verdict from a shape
// it half-understands. "pass, because I couldn't read the facts" is the failure mode being prevented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COIR_IMPACT_SUPPORTED, COPSE_SUPPORTED, assertCoirClickmap, assertCoirImpact, assertCopse,
} from '../src/contract.mjs';

const throws = (fn, re, msg) => assert.throws(fn, (e) => {
  assert.equal(e.code, 'contract-mismatch', 'a contract failure must be identifiable, not just prose');
  assert.match(e.message, re, msg);
  return true;
});

test('copse: a supported version passes through, and the caps object is returned unchanged', () => {
  const caps = { contractVersion: COPSE_SUPPORTED[0], engine: 'cocos', clickSurface: true };
  assert.equal(assertCopse(caps), caps);
});

test('copse: a MISSING version is too old, not "probably fine"', () => {
  // Every copse that carries the field announces it, so absence is information — it predates the contract.
  // Treating absent as compatible is how a silent mismatch gets in.
  throws(() => assertCopse({ engine: 'cocos' }), /no contractVersion|too old/i);
  throws(() => assertCopse(null), /no contractVersion|too old/i);
});

test('copse: the error says WHICH SIDE is stale, because that decides what you upgrade', () => {
  const newest = Math.max(...COPSE_SUPPORTED);
  throws(() => assertCopse({ contractVersion: newest + 1 }), /copse is NEWER.*upgrade arbor/i);
  throws(() => assertCopse({ contractVersion: 0 }), /older.*upgrade copse/i);
});

test('copse: the message names where copse was resolved from — the actual fix is usually a wrong path', () => {
  throws(() => assertCopse({ contractVersion: 99 }, '../some/other/copse'), /some\/other\/copse/);
});

test('coir impact: a supported schema passes; a missing or unknown one fails loud', () => {
  const risk = { schema: COIR_IMPACT_SUPPORTED[0], changed: [], impactedScenes: [] };
  assert.equal(assertCoirImpact(risk), risk);
  throws(() => assertCoirImpact({ changed: [] }), /no `schema`|too old/i);
  throws(() => assertCoirImpact({ schema: 99 }), /schema is v99/);
});

test('coir clickmap: shape-checked instead of versioned — an empty scene is legal', () => {
  // clickmap is array-shaped and can carry no version field, so the guard is the shape arbor binds to.
  assert.deepEqual(assertCoirClickmap([]), []);
  const rows = [{ nodePath: 'Canvas/Btn', method: 'go', component: 'X' }];
  assert.equal(assertCoirClickmap(rows), rows);
});

test('coir clickmap: a non-array, or rows without nodePath, is drift — NOT an empty coverage result', () => {
  // The failure this prevents: a changed output shape yields zero matched rows, and a coverage gate then
  // reports full coverage of nothing. Silence would be indistinguishable from a clean run.
  throws(() => assertCoirClickmap({ rows: [] }), /not an array|shape changed/i);
  throws(() => assertCoirClickmap(null), /not an array|shape changed/i);
  throws(() => assertCoirClickmap([{ method: 'go' }]), /nodePath/);
});

test('the supported lists are non-empty — an empty one would reject every sibling', () => {
  assert.ok(COPSE_SUPPORTED.length > 0 && COIR_IMPACT_SUPPORTED.length > 0);
});
