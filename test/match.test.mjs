// Phase-3 safety net: the coir↔copse tail-match contract. arbor's copy (match.mjs) must behave EXACTLY
// like copse's `tailMatch` — coverage.test.js pins the same shape on copse's side, so these cases catch
// any drift between the two copies of the shared vocabulary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tailMatch } from '../src/match.mjs';

test('exact full 1-segment alignment matches (a genuinely unique short leaf still joins)', () => {
  assert.deepEqual(tailMatch('Btn', 'Btn'), { mount: '', dropped: '' });
});

test('suffix match strips coir scene-root prefix into `dropped`', () => {
  assert.deepEqual(tailMatch('home/Canvas/AttackBtn', 'Canvas/AttackBtn'), { mount: '', dropped: 'home' });
});

test('prefab instantiation shows up as `mount` on the runtime side', () => {
  assert.deepEqual(tailMatch('ShopPanel/BuyBtn', 'Canvas/Shop/ShopPanel/BuyBtn'), { mount: 'Canvas/Shop', dropped: '' });
});

test('[i] indices are ignored in the fuzzy name compare', () => {
  assert.deepEqual(tailMatch('Item/Btn', 'List/Item[3]/Btn'), { mount: 'List', dropped: '' });
});

test('a weak 1-segment PARTIAL suffix does not match (below MIN_FUZZY_TAIL)', () => {
  assert.equal(tailMatch('btn', 'Canvas/Panel/btn'), null);
});

test('no shared tail, or empty, → null', () => {
  assert.equal(tailMatch('A/X', 'B/Y'), null);
  assert.equal(tailMatch('', 'Canvas'), null);
  assert.equal(tailMatch('Canvas/A', 'Canvas/B'), null); // last segment differs
});

// DRIFT GUARD: arbor's vendored tailMatch must behave IDENTICALLY to copse's public one (the single
// declared contract). Imports copse's real export and asserts parity — any divergence between the two
// copies fails here. Skips gracefully if copse isn't adjacent (e.g. arbor extracted to its own repo).
test('cross-check: arbor tailMatch === copse public tailMatch on the shared contract', async () => {
  let copseTailMatch;
  try { ({ tailMatch: copseTailMatch } = await import(new URL('../../copse/src/index.js', import.meta.url).href)); }
  catch { return; } // copse not a sibling repo → nothing to cross-check against (skip)
  const cases = [
    ['Btn', 'Btn'], ['home/Canvas/AttackBtn', 'Canvas/AttackBtn'],
    ['ShopPanel/BuyBtn', 'Canvas/Shop/ShopPanel/BuyBtn'], ['Item/Btn', 'List/Item[3]/Btn'],
    ['Row/Cell[0]/Btn', 'Canvas/List/Row[3]/Cell[1]/Btn'], ['btn', 'Canvas/Panel/btn'],
    ['A/X', 'B/Y'], ['', 'Canvas'], ['Canvas/A', 'Canvas/B'], ['main/Canvas/Menu/x', 'Canvas/Menu/x'],
  ];
  for (const [s, r] of cases) {
    assert.deepEqual(tailMatch(s, r), copseTailMatch(s, r), `drift on tailMatch(${JSON.stringify(s)}, ${JSON.stringify(r)})`);
  }
});
