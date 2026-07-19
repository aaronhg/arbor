// arbor · config — defineConfig() (the consumer's arbor.config.mjs entry, like playwright.config) and
// the loader. Paths in the config (spec, driver.copse, analyzer.coir) are resolved relative to the
// config FILE, so a consumer writes `../copse` and it just works regardless of cwd.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function defineConfig(cfg) {
  return {
    url: cfg.url || 'http://127.0.0.1:8899/',
    engine: cfg.engine || 'cocos',       // 'cocos' | 'pixi' | 'auto' — DECLARED (no longer a silent assumption); drives copse's bundle + capability profile
    webServer: cfg.webServer || null,    // { command, url?, timeout?, reuseExisting? } — arbor starts/stops it
    driver: cfg.driver || {},            // { copse: '<path or package>' }
    analyzer: cfg.analyzer || {},        // { coir: '<path or package>' }  — for `impact`
    surface: cfg.surface || '',          // the agent's driving brief for THIS game (refs/sels)
    spec: cfg.spec || null,              // design spec (oracle for verify/orchestrate)
    specMin: cfg.specMin || null,        // an optional reduced spec (blind-spot probe)
    pinnable: cfg.pinnable || '',        // description of the game's pinnable RNG hooks (for orchestrate's coordinator)
    groundTruth: cfg.groundTruth || null,// answer key ({bugs:[{id, detection_hint}]}) — enables the outcome judge (detection_rate)
    evalStore: cfg.evalStore || null,    // append-only JSONL log of outcome-judged runs (detection trend over time)
    thresholds: cfg.thresholds || {},    // { detection, evidence } — a run below these fails (the outcome gate); also --min-detection/--min-evidence
    scenarios: cfg.scenarios || [],      // calibration scenarios (planted-bug goals + pins)
    // ── deterministic (zero-LLM) gate config ──
    scene: cfg.scene || null,            // scene file for coir clickmap (coverage / gate)
    tests: cfg.tests || 'ci/tests',      // flow-script dir (gate runs the affected ones)
    coverage: cfg.coverage || {},        // { baseline, rows }  — coir × copse coverage vs a committed baseline
    visual: cfg.visual || {},            // { baseline, refs }  — golden pixel signatures
    model: cfg.model || null,            // null → ANTHROPIC_MODEL env / llm.mjs default
    reporters: cfg.reporters || ['console'],
    candidatesDir: cfg.candidatesDir || 'ci/candidates',  // where F5 stages frozen tripwires
    _dir: cfg._dir || process.cwd(),     // set by loadConfig to the config file's directory
  };
}

// resolve a config-relative path (spec/copse/coir/candidatesDir) against the config file's dir
export const resolvePath = (config, p) => !p ? p : (isAbsolute(p) ? p : resolve(config._dir, p));

// find arbor.config.mjs walking up from cwd (like jest/playwright locating their config)
function findConfig(start = process.cwd()) {
  for (let dir = start; ; dir = dirname(dir)) {
    const p = join(dir, 'arbor.config.mjs');
    if (existsSync(p)) return p;
    if (dir === dirname(dir)) return null;
  }
}

export async function loadConfig(explicitPath) {
  const path = explicitPath ? resolve(explicitPath) : findConfig();
  if (!path || !existsSync(path)) throw new Error('no arbor.config.mjs found (pass --config <path>)');
  const mod = await import(pathToFileURL(path).href);
  const cfg = mod.default || mod.config;
  if (!cfg) throw new Error(path + ' has no default export (use: export default defineConfig({…}))');
  cfg._dir = dirname(path);
  return cfg;
}

// read a spec file (spec / specMin), config-relative → its text
export const readSpec = (config, which = 'spec') => {
  const p = resolvePath(config, config[which]);
  return p ? readFileSync(p, 'utf8') : null;
};
