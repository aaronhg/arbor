// Phase-0 safety net: defineConfig defaults, resolvePath, and loadConfig walk-up — the config plumbing
// every mode depends on, so the relocation phases can't silently break path resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, resolvePath, loadConfig, readSpec } from '../src/config.mjs';

const CONFIG_MOD = new URL('../src/config.mjs', import.meta.url).href; // file:// URL, cwd-independent

test('defineConfig fills the defaults callers rely on', () => {
  const c = defineConfig({});
  assert.equal(c.url, 'http://127.0.0.1:8899/');
  assert.deepEqual(c.reporters, ['console']);
  assert.deepEqual(c.thresholds, {});   // the outcome gate reads config.thresholds.detection — must be an object
  assert.deepEqual(c.driver, {});
  assert.deepEqual(c.scenarios, []);
  assert.equal(c.tests, 'ci/tests');
  assert.equal(c.groundTruth, null);
  // passed-through values win
  const c2 = defineConfig({ url: 'http://x/', reporters: ['json'], model: 'm', thresholds: { detection: 3 } });
  assert.equal(c2.url, 'http://x/');
  assert.deepEqual(c2.reporters, ['json']);
  assert.equal(c2.thresholds.detection, 3);
});

test('resolvePath: absolute stays, relative resolves against the config dir (not cwd)', () => {
  const cfg = { _dir: '/proj/root' };
  assert.equal(resolvePath(cfg, '/abs/x.json'), '/abs/x.json');
  assert.equal(resolvePath(cfg, './ci/expected.json'), '/proj/root/ci/expected.json');
  assert.equal(resolvePath(cfg, '../copse'), '/proj/copse');
  assert.equal(resolvePath(cfg, null), null); // absent path stays absent
});

test('loadConfig walks up to find arbor.config.mjs and stamps _dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arbor-cfg-'));
  writeFileSync(join(root, 'arbor.config.mjs'), `import { defineConfig } from '${CONFIG_MOD}';\nexport default defineConfig({ url: 'http://fixture/', spec: './s.md' });\n`);
  writeFileSync(join(root, 's.md'), '# spec body');
  const nested = join(root, 'a', 'b'); mkdirSync(nested, { recursive: true });
  const cfg = await loadConfig(join(root, 'arbor.config.mjs'));
  assert.equal(cfg.url, 'http://fixture/');
  assert.equal(cfg._dir, root);                       // _dir = the config file's directory
  assert.equal(resolvePath(cfg, cfg.spec), join(root, 's.md')); // spec resolves against _dir, not cwd
  assert.equal(readSpec(cfg), '# spec body');
});
