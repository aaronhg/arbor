// Cross-repo CONTRACT test: arbor resolves copse/coir through their PUBLISHED surface (exports + bin maps),
// not hardcoded internal file paths — run against the REAL copse/coir manifests, so a future export rename
// in either package is caught here instead of at a mode's first `import`. copseCli/coirCli read the bin map;
// openDriver reads the export map — this locks both.
//
// SKIPS GRACEFULLY when copse/coir aren't checked out alongside arbor (arbor's own standalone CI): it needs
// the real siblings to assert against. Reversing this into copse/coir's CI — so THEY re-run it and go red
// when they rename an export — is the "consumer-driven contract" step (see the boundary-contract plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pkgExport, pkgBin, copseCli, coirCli } from '../src/driver.mjs';

// arbor is a standalone repo, with copse/coir as sibling repos. A config's _dir is the consumer's project
// dir; here we stand arbor's own root in for it so '../copse' / '../coir' resolve to the real siblings.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = { _dir: ROOT, driver: { copse: '../copse' }, analyzer: { coir: '../coir' } };
const copseRoot = resolve(ROOT, '../copse');
const coirRoot = resolve(ROOT, '../coir');
// present only when the sibling repos are checked out next to arbor (local dev, or a reversed producer CI).
const skip = (existsSync(join(copseRoot, 'package.json')) && existsSync(join(coirRoot, 'package.json')))
  ? false : 'copse/coir not checked out alongside arbor (a cross-repo contract test)';

test('pkgExport resolves copse public subpaths to real files (driver-puppeteer, harness)', { skip }, () => {
  const drv = pkgExport(copseRoot, './driver-puppeteer');
  assert.equal(drv, join(copseRoot, 'src/drivers/puppeteer.js'));
  assert.ok(existsSync(drv), 'the resolved driver file must exist');
  const harn = pkgExport(copseRoot, './harness');   // added in Phase 2
  assert.equal(harn, join(copseRoot, 'src/harness.js'));
  assert.ok(existsSync(harn), 'the resolved harness file must exist');
});

test('pkgExport throws (naming the real exports) for a subpath the package does NOT export', { skip }, () => {
  assert.throws(() => pkgExport(copseRoot, './internal-secret'), (e) => {
    assert.match(e.message, /not a public export/);
    assert.match(e.message, /driver-puppeteer/); // lists what IS exported, so the failure is actionable
    return true;
  });
});

test('pkgBin resolves the copse and coir CLI entries from the bin map', { skip }, () => {
  assert.equal(pkgBin(copseRoot, 'copse'), join(copseRoot, 'src/cli.js'));
  assert.equal(pkgBin(coirRoot, 'coir'), join(coirRoot, 'src/cli.js'));
});

test('copseCli / coirCli resolve via the manifest for a config-pointed root (env overrides win)', { skip }, () => {
  assert.equal(copseCli(config), join(copseRoot, 'src/cli.js'));
  assert.equal(coirCli(config), join(coirRoot, 'src/cli.js'));
});
