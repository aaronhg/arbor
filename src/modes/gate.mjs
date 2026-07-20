// arbor · gate (zero-LLM, F2/F3) — the impact-SCOPED deterministic gate. coir impact reads a diff → risk
// set; empty → skip; non-empty → run ONLY the affected flow tests (copse affected + copse run) + the
// coverage-regression gate. The cheap PR-time counterpart of `arbor coverage` (which runs the full join).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coirCli, copseCli } from '../driver.mjs';
import { resolvePath } from '../config.mjs';
import { affectedData } from '../select.mjs';
import { coverage } from './coverage.mjs';
import { assertCoirImpact } from '../contract.mjs';

export async function gate(config, opts = {}) {
  const coir = coirCli(config), copse = copseCli(config);
  const sh = (args, o = {}) => execFileSync('node', args, { encoding: 'utf8', ...o });

  // 1 · impact → risk set (from a --patch diff, else --paths a,b)
  const impactArgs = [coir, '-C', config._dir, 'impact'];
  let input;
  if (opts.patch) { impactArgs.push('--patch', '-'); input = opts.patch === '-' ? readFileSync(0, 'utf8') : readFileSync(resolvePath(config, opts.patch), 'utf8'); }
  else if (opts.paths) impactArgs.push(...String(opts.paths).split(',').map((s) => s.trim()));
  else throw new Error('gate: need --patch <diff|-> or --paths a,b');
  impactArgs.push('-o', 'json');
  const risk = assertCoirImpact(JSON.parse(sh(impactArgs, input ? { input } : {})),
    (config.analyzer && config.analyzer.coir) || 'analyzer.coir');
  const nB = (risk.impactedButtons || []).length, nS = (risk.impactedScenes || []).length;
  console.log(`impact — ${risk.changed.length} changed · ${nS} scene/prefab · ${nB} button(s) · risk ${risk.riskScore}`);

  // 2 · layered trigger — nothing wired-and-testable → skip the expensive checks
  if (!nB && !nS) return { mode: 'gate', skipped: true, summary: 'skip — this change touches no UI surface', failed: false };

  // 3 · affected flow tests — arbor's OWN selection (pure): the tests whose driven nodePaths intersect the
  // risk set. (Was `copse affected`; the selection needs neither a live game nor project files → arbor.)
  const testsDir = resolvePath(config, config.tests || 'ci/tests');
  let testFiles = []; try { testFiles = readdirSync(testsDir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no tests dir → nothing to select */ }
  const tests = testFiles.map((name) => ({ name, script: JSON.parse(readFileSync(join(testsDir, name), 'utf8')) }));
  const aff = affectedData(risk, tests);
  console.log(`affected — ${aff.affected.length}/${aff.affected.length + aff.skipped.length} tests: ${aff.affected.map((r) => r.name).join(', ') || '(none)'}`);
  let rc = 0;
  if (aff.affected.length) {
    const stage = mkdtempSync(join(tmpdir(), 'arbor-pr-'));
    for (const r of aff.affected) copyFileSync(join(testsDir, r.name), join(stage, r.name));
    console.log('\n── affected flow suite ─────────────────────────────');
    try { console.log(sh([copse, 'run', config.url, stage, ...(opts.headed ? ['--headed'] : [])])); }
    catch (e) { console.log((e.stdout || '') + (e.stderr || '')); rc = 1; }
  }

  // 4 · coverage-regression gate
  console.log('── coverage gate ─────────────────────────────');
  const cov = await coverage(config, { headed: opts.headed });
  if (cov.failed) rc = 1;

  return { mode: 'gate', scoped: true, impacted: { buttons: nB, scenes: nS }, affected: aff.affected.map((r) => r.name), coverageFailed: cov.failed, summary: rc ? 'scoped gate failed' : 'scoped gate green', failed: rc === 1 };
}
