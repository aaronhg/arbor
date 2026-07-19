// arbor · driver — the bridge to copse (the runtime driver) and coir (the static analyzer). Resolves
// their locations from the config (`driver.copse` / `analyzer.coir`), then talks to them through the
// surface they PUBLISH — the package.json `exports` + `bin` maps — never a guessed internal file path.
// So if copse renames an internal file, its export map still points true and arbor keeps working; and if
// arbor reaches for a subpath the package doesn't export, it fails LOUD (that's the coupling to remove).
import { join, resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolvePath } from './config.mjs';

const readPkg = (root) => { try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch (e) { throw new Error(`arbor: no readable package.json at ${root} — point driver.copse / analyzer.coir at the package root (${e.message})`); } };
const condTarget = (v) => (typeof v === 'string' ? v : (v && (v.import || v.node || v.default)) || null); // conditional export object → a path
// Resolve a package's PUBLIC export subpath to an absolute file. Throws (naming what IS exported) when the
// subpath isn't public — surfacing the moment arbor reaches past the declared API. (Exported for tests.)
export function pkgExport(root, subpath) {
  const exp = readPkg(root).exports || {};
  const target = condTarget(exp[subpath]);
  if (!target) throw new Error(`arbor: '${subpath}' is not a public export of ${root} (exports: ${Object.keys(exp).join(', ') || 'none'}). Add it to the package's exports, or stop importing it.`);
  return resolve(root, target);
}
// Resolve a package's declared bin entry to an absolute file (the CLI's PUBLIC entry point). (Exported for tests.)
export function pkgBin(root, name) {
  const bin = readPkg(root).bin;
  const target = typeof bin === 'string' ? bin : (bin && bin[name]);
  if (!target) throw new Error(`arbor: ${root} declares no bin '${name}' (bin: ${JSON.stringify(bin) || 'none'})`);
  return resolve(root, target);
}
// Fallback when no config path is given: resolve the package BY NAME from the consumer's node_modules
// (post-extraction: `npm i copse coir`). null when not installed → the default relative path is tried.
function byName(name, config) {
  try { return dirname(createRequire(join(config._dir, 'x.js')).resolve(`${name}/package.json`)); } catch { return null; }
}

const copseRoot = (config) => resolvePath(config, config.driver && config.driver.copse) || byName('copse', config) || join(config._dir, '../copse');
const coirRoot = (config) => resolvePath(config, config.analyzer && config.analyzer.coir) || byName('coir', config) || join(config._dir, '../coir');

export const copseCli = (config) => process.env.COPSE_CLI || pkgBin(copseRoot(config), 'copse');
export const coirCli = (config) => process.env.COIR_CLI || pkgBin(coirRoot(config), 'coir');

// open a copse session against config.url; returns { cp, execute, caps }. `execute` is copse's
// deterministic FACT primitive (run steps → {steps, facts}); arbor owns the loop + verdict over it (via
// harness.runLoop), NOT copse's runHarness gate `pass`. caps is the engine's declared capability profile
// (copse owns it) so modes BRANCH instead of assuming cocos. Fails LOUD when the engine never installs.
export async function openDriver(config, { headed = false } = {}) {
  const root = copseRoot(config);
  const { connect } = await import(process.env.COPSE_DRIVER || pkgExport(root, './driver-puppeteer'));
  const { execute } = await import(process.env.COPSE_HARNESS || pkgExport(root, './harness'));
  const cp = await connect(config.url, { engine: config.engine || 'cocos', headless: headed ? false : 'new' });
  await cp.engineReady();                          // resolve the engine before anyone reads caps
  if (!cp.installed) {                              // no engine came up → fail LOUD (never a silent cocos hang)
    const seen = cp.engineDetected ? cp.engine : 'no engine detected';
    try { await cp.close(); } catch { /* */ }
    throw new Error(`arbor: copse could not install on ${config.url} (${seen}). `
      + `If this is a Pixi game set engine:'pixi' in arbor.config.mjs; if Cocos, check the build is served. `
      + `Run \`copse doctor ${config.url}\` for the full report.`);
  }
  return { cp, execute, caps: cp.capabilities };
}

// Guard: throw a clear, actionable error when a mode needs a capability the connected engine lacks.
// Pure (caps is copse's declared profile) so it's unit-testable without a browser.
export function requireCapability(caps, cap, mode) {
  if (caps && caps[cap]) return;
  const why = cap === 'clickSurface' ? 'coverage/gate are Cocos-only (Pixi serializes no click handlers). '
    : cap === 'stableRefs' ? 'frozen tripwires replay by ref, which is only stable on Cocos. '
    : cap === 'visualManifest' ? 'the visual gate needs node-anchored pixel rects. ' : '';
  throw new Error(`arbor ${mode}: needs \`${cap}\`, which the ${(caps && caps.engine) || 'detected'} engine doesn't support. ${why}Skip this mode for this engine.`);
}

// reload to a fresh scene and re-apply the scenario's RNG pins (the deterministic setup)
export async function applyPins(cp, pins) {
  await cp.reload();
  for (const p of pins || []) await cp.patch(p.sel, { replace: p.replace });
}
