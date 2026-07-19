#!/usr/bin/env node
// arbor CLI — `arbor <mode> [flags]`. Reads arbor.config.mjs (walk-up, or --config), runs the mode,
// pipes the result through the configured reporters, exits 0/1. Two tiers: the zero-LLM GATE modes
// (coverage/visual/gate — the always-on floor) and the AI modes (need an LLM). Playwright-style: no
// url on the command line — it lives in the config.
import { loadConfig } from '../src/config.mjs';
import { GATE_MODES, AI_MODES, MODES } from '../src/index.mjs';

const [mode, ...rest] = process.argv.slice(2);
// value flags only (booleans use rest.includes) — a flag with no value / followed by another --flag falls back to the default
const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : d; };

if (!mode || (!MODES.includes(mode) && mode !== 'init') || rest.includes('--help')) {
  console.error(`usage: arbor <mode> [flags]

  init        scaffold arbor.config.mjs + qa/ from coir clickmap  (--scene <f> · --url <u> · --force)

  ── gate (zero-LLM, the always-on floor) ──
  coverage    coir × copse coverage vs the baseline  (--update · --selftest)
  visual      golden pixel signatures vs the baseline (--update · --refs a,b)
  gate        impact-scoped PR gate:  arbor gate --patch <diff>   (or --paths a,b)

  ── AI (opt-in; needs ANTHROPIC_API_KEY or the claude CLI) ──
  calibrate   scenarios ×N → detection rate  (--freeze · --scenario id · --runs N)
  verify      spec-grounded  (--min)          orchestrate  coordinator → workers → judge
  impact      a diff drives the run:  arbor impact --patch <diff>  (or --path <f> --methods a,b)
  explore     free divergent probe        agentic  claude -p drives copse MCP autonomously (multi-turn)
  (findings modes auto-score vs config.groundTruth — detected/missed/detection_rate/evidence)

  common: --headed · --model <id> · --reporter <name> · --config <path> · --fail-on flaky|missed|never`);
  process.exit(mode ? 0 : 2);
}

const opts = {
  runs: flag('--runs'), scenario: flag('--scenario'), freeze: rest.includes('--freeze'), headed: rest.includes('--headed'),
  patch: flag('--patch'), path: flag('--path'), paths: flag('--paths'), methods: flag('--methods'),
  min: rest.includes('--min'), update: rest.includes('--update'), selftest: rest.includes('--selftest'), refs: flag('--refs'),
  reporter: flag('--reporter'), config: flag('--config'), failOn: flag('--fail-on', 'flaky'),
  scene: flag('--scene'), url: flag('--url'), coir: flag('--coir'), copse: flag('--copse'), force: rest.includes('--force'),
  budget: flag('--budget'), minDetection: flag('--min-detection'), minEvidence: flag('--min-evidence'),
};

if (mode === 'init') { // scaffolds the config — no config to load yet
  const { init } = await import('../src/init.mjs');
  await init(opts);
  process.exit(0);
}

const config = await loadConfig(typeof opts.config === 'string' ? opts.config : undefined);
const modelFlag = flag('--model');
if (modelFlag) process.env.ANTHROPIC_MODEL = modelFlag;
else if (config.model && !process.env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = config.model;

if (AI_MODES.includes(mode)) { // the gate modes are zero-LLM — no key needed
  const { hasLLM } = await import('../src/llm.mjs');
  if (!hasLLM()) { console.error('arbor: no LLM available — set ANTHROPIC_API_KEY or log in the `claude` CLI. (This AI mode is skipped; the zero-LLM gate modes still run.)'); process.exit(3); }
}

const { startWebServer } = await import('../src/webserver.mjs');
const stopServer = await startWebServer(config);          // no-op unless config.webServer is set
let result;
try {
  const modMod = await import(`../src/modes/${mode}.mjs`);
  result = await modMod[mode](config, opts);
} finally { stopServer(); }

// outcome eval (gstack's outcomeJudge): AI modes only (never the zero-LLM gate modes), when there's an
// answer key and the mode produced a free-form findings/report (calibrate self-scores → skip via detectionRate).
if (config.groundTruth && AI_MODES.includes(mode) && result && result.detectionRate == null && (result.findings || result.report) && !result.score) {
  const { outcomeJudge } = await import('../src/eval.mjs');
  try { result.score = await outcomeJudge(config, (result.findings && result.findings.length) ? result.findings : (result.report || result.findings)); }
  catch (e) { result.score = { error: e.message }; }
}

// B — outcome gate: fail the run if detection / evidence is below the threshold (flag or config.thresholds)
if (result.score && !result.score.error) {
  const minDet = opts.minDetection ?? config.thresholds.detection;
  const minEv = opts.minEvidence ?? config.thresholds.evidence;
  if (minDet != null && result.score.detection_rate < Number(minDet)) { result.failed = true; console.error(`  ✗ detection ${result.score.detection_rate} < min ${minDet}`); }
  if (minEv != null && (result.score.evidence_quality || 0) < Number(minEv)) { result.failed = true; console.error(`  ✗ evidence ${result.score.evidence_quality} < min ${minEv}`); }
}

// A — record the run to the eval trend store (regression tracking): outcome-judged runs AND calibrate (self-scored)
if (config.evalStore && (result.score || result.detectionRate != null)) { const { recordEval } = await import('../src/evalstore.mjs'); recordEval(config, result); }

const reporters = opts.reporter ? [opts.reporter] : config.reporters;
for (const r of reporters) { const rep = await import(`../src/reporters/${r}.mjs`); rep.report(result, { config }); }

process.exit(result.failed ? 1 : 0);
