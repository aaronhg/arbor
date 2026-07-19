// arbor · calibrate — the scenario matrix (F4 explore · F6 judge · F5 freeze · F7 ×N). Runs the
// config's calibration scenarios N times, aggregates stable/flaky, and (with --freeze) serializes each
// stable semantic finding into a candidate tripwire, replayed green via `copse run`.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDriver, applyPins, copseCli } from '../driver.mjs';
import { runAgent, aggregate, toScript, compactSteps } from '../harness.mjs';
import { USAGE, MODEL } from '../llm.mjs';
import { resolvePath } from '../config.mjs';

export async function calibrate(config, opts = {}) {
  const runs = Number(opts.runs || 3);
  const only = opts.scenario ? String(opts.scenario).split(',').map((s) => s.trim()) : null;
  const scenarios = config.scenarios.filter((s) => !only || only.includes(s.id));
  const { cp, execute, caps } = await openDriver(config, { headed: opts.headed });

  const results = [], exemplar = new Map();
  try {
    for (let n = 0; n < runs; n++) for (const sc of scenarios) {
      await applyPins(cp, sc.pins);
      const f = await runAgent(cp, sc, execute, config.surface);
      results.push(f);
      if (f.by === 'judge' && !exemplar.has(f.id)) exemplar.set(f.id, f); // freeze ONLY a conclusive semantic bug
      console.log(`  run ${n + 1}/${runs}  ${String(sc.id).padEnd(20)} ${f.detected ? '🔴 found' : '⚪ missed'}  (${f.by})  ${f.reason}`.slice(0, 160));
    }
  } finally { await cp.close(); }

  const agg = aggregate(results);
  const candidates = [];
  // F5 freeze replays a tripwire BY REF — only trustworthy where refs are stable (Cocos). On an engine
  // with positional refs (Pixi), skip freezing rather than stage a candidate that can't replay reliably.
  if (opts.freeze && !caps.stableRefs) console.log(`  (freeze skipped — ${caps.engine} refs are positional; a frozen tripwire can't replay reliably)`);
  if (opts.freeze && caps.stableRefs) {
    const OUT = resolvePath(config, config.candidatesDir); mkdirSync(OUT, { recursive: true });
    const COPSE = copseCli(config);
    for (const s of agg.scenarios.filter((x) => x.stable)) {
      const ex = exemplar.get(s.id), script = ex && toScript(ex);
      if (!script) { candidates.push({ id: s.id, bug: s.bug, outcome: 'none', why: 'gate finding — coverage gate guards it' }); continue; }
      const path = join(OUT, `${script.name}.json`);
      writeFileSync(path, JSON.stringify(script, null, 2) + '\n');
      let ok = false;
      try { execFileSync('node', [COPSE, 'run', config.url, path, ...(opts.headed ? ['--headed'] : [])], { encoding: 'utf8' }); ok = true; }
      catch { rmSync(path, { force: true }); } // doesn't replay green → not a repro → discard
      console.log(`  ▶ ${script.name}.json → replay ${ok ? 'green ✓  (staged)' : 'RED ✗ — discarded'}`);
      candidates.push({ id: s.id, bug: s.bug, file: `${script.name}.json`, outcome: ok ? 'staged' : 'discarded', steps: script.steps.length });
    }
  }

  const missed = agg.scenarios.some((s) => s.detections === 0);
  return {
    mode: 'calibrate', url: config.url, runs, model: MODEL, usage: { ...USAGE },
    scenarios: agg.scenarios, detectionRate: agg.detectionRate, stableCount: agg.stableCount, flakyCount: agg.flakyCount, candidates,
    findings: results.map((f) => ({ id: f.id, bug: f.bug, kind: f.kind, detected: f.detected, by: f.by, reason: f.reason, rationale: f.rationale, trace: compactSteps(f.raw) })),
    failed: opts.failOn === 'never' ? false : opts.failOn === 'missed' ? missed : agg.detectionRate !== 1,
  };
}
