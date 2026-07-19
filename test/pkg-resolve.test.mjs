// Phase-2 safety net: arbor resolves copse/coir through their PUBLISHED surface (exports + bin maps),
// not hardcoded internal file paths. These run against the REAL copse/coir manifests, so a future export
// rename in either package is caught here instead of at a mode's first `import`. copseCli/coirCli read the
// bin map; openDriver reads the export map — this locks both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pkgExport, pkgBin, copseCli, coirCli } from '../src/driver.mjs';

// this test lives at <arbor>/test/ — arbor is a standalone repo now, with copse/coir as sibling repos.
// A config's _dir is the consumer's project dir; here we stand arbor's own root in for it so the
// '../copse' / '../coir' paths resolve to the real sibling checkouts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = { _dir: ROOT, driver: { copse: '../copse' }, analyzer: { coir: '../coir' } };
const copseRoot = resolve(ROOT, '../copse');
const coirRoot = resolve(ROOT, '../coir');

test('pkgExport resolves copse public subpaths to real files (driver-puppeteer, harness)', () => {
  const drv = pkgExport(copseRoot, './driver-puppeteer');
  assert.equal(drv, join(copseRoot, 'src/drivers/puppeteer.js'));
  assert.ok(existsSync(drv), 'the resolved driver file must exist');
  const harn = pkgExport(copseRoot, './harness');   // added in Phase 2
  assert.equal(harn, join(copseRoot, 'src/harness.js'));
  assert.ok(existsSync(harn), 'the resolved harness file must exist');
});

test('pkgExport throws (naming the real exports) for a subpath the package does NOT export', () => {
  assert.throws(() => pkgExport(copseRoot, './internal-secret'), (e) => {
    assert.match(e.message, /not a public export/);
    assert.match(e.message, /driver-puppeteer/); // lists what IS exported, so the failure is actionable
    return true;
  });
});

test('pkgBin resolves the copse and coir CLI entries from the bin map', () => {
  assert.equal(pkgBin(copseRoot, 'copse'), join(copseRoot, 'src/cli.js'));
  assert.equal(pkgBin(coirRoot, 'coir'), join(coirRoot, 'src/cli.js'));
});

test('copseCli / coirCli resolve via the manifest for a config-pointed root (env overrides win)', () => {
  assert.equal(copseCli(config), join(copseRoot, 'src/cli.js'));
  assert.equal(coirCli(config), join(coirRoot, 'src/cli.js'));
});
