// Phase-1 safety net: requireCapability — the guard that turns "silently assume cocos" into "branch on the
// engine's declared profile, or fail with an actionable message". Pure (caps is copse's declared profile),
// so it's testable without a browser. Locks the branch before the AI-loop phases lean on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireCapability } from '../src/driver.mjs';

const cocos = { engine: 'cocos', clickSurface: true, stableRefs: true, reachability: true, visualManifest: true };
const pixi = { engine: 'pixi', clickSurface: false, stableRefs: false, reachability: true, visualManifest: true };

test('a present capability passes silently', () => {
  assert.doesNotThrow(() => requireCapability(cocos, 'clickSurface', 'coverage'));
  assert.doesNotThrow(() => requireCapability(pixi, 'visualManifest', 'visual'));
});

test('a missing capability throws an actionable error naming the mode, cap, and engine', () => {
  assert.throws(() => requireCapability(pixi, 'clickSurface', 'coverage'), (e) => {
    assert.match(e.message, /coverage/);       // the mode
    assert.match(e.message, /clickSurface/);    // the capability
    assert.match(e.message, /pixi/);            // the engine
    assert.match(e.message, /Cocos-only/);      // the why
    return true;
  });
});

test('null/absent caps (engine never resolved) throws — never silently proceeds', () => {
  assert.throws(() => requireCapability(null, 'clickSurface', 'coverage'), /needs `clickSurface`/);
  assert.throws(() => requireCapability({ engine: null }, 'stableRefs', 'calibrate'), /stableRefs/);
});
