// arbor · coverage (zero-LLM) — THE gate. coir clickmap (what's WIRED) × copse coverage (what a player
// can HIT) → buckets, diffed against a committed baseline. Green normally, red on regression (a new
// dead/blocked button, or a covered one going unreachable). `--update` rewrites the baseline;
// `--selftest` proves the gate can actually go red.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolvePath } from '../config.mjs';
import { coirCli, openDriver, requireCapability } from '../driver.mjs';
import { coverageJoin } from '../join.mjs';
import { assertCoirClickmap } from '../contract.mjs';

const idOf = (o) => `${o.nodePath || o.ref}::${o.method ?? 'null'}`;

// THE gate's diff, in one place — the live gate AND `--selftest` both call it, so the certified-can-go-red
// path is the same code that fails a PR (the old two-copy version could pass selftest while the live diff rotted).
export const diffBaseline = (base, findings, coveredIds) => {
  const baseIds = new Set(base.findings.map((f) => `${f.kind}|${f.id}`));
  const newFindings = findings.filter((f) => !baseIds.has(`${f.kind}|${f.id}`));
  const regressed = base.coveredIds.filter((c) => !coveredIds.includes(c));
  return { baseIds, newFindings, regressed, failed: newFindings.length > 0 || regressed.length > 0 };
};

// coir clickmap (STATIC, no game) × copse clickSurface (LIVE) → arbor joins the two IN-PROCESS. The join
// (coverageJoin) moved here from copse; copse now supplies only the runtime half (clickSurface), which is
// Cocos-only — so coverage is capability-gated (Pixi rejects with a clear message, not a silent bad join).
async function runCoverage(config, { headed } = {}) {
  const rowsFile = resolvePath(config, config.coverage.rows || 'ci/coir-rows.json');
  mkdirSync(dirname(rowsFile), { recursive: true }); // the rows dir may not exist yet (e.g. a fresh `arbor init` scaffold)
  const staticRows = assertCoirClickmap(
    JSON.parse(execFileSync('node', [coirCli(config), '-C', config._dir, 'clickmap', config.scene, '-o', 'json'], { encoding: 'utf8', maxBuffer: 64 << 20 })),
    (config.analyzer && config.analyzer.coir) || 'analyzer.coir');
  writeFileSync(rowsFile, JSON.stringify(staticRows)); // keep the static rows on disk for inspection/debugging
  const { cp, caps } = await openDriver(config, { headed });
  try {
    requireCapability(caps, 'clickSurface', 'coverage'); // branch on the engine, not an assumption
    const surface = await cp.clickSurface({ reachability: true });
    return { cov: coverageJoin(staticRows, surface), wired: staticRows.length };
  } finally { await cp.close(); }
}

export const reduce = (cov) => ({
  findings: [
    ...cov.blocked.map((o) => ({ kind: 'wired-but-unreachable', id: idOf(o), blockedBy: o.runtime?.blockedBy })),
    ...cov.ambiguous.map((o) => ({ kind: 'ambiguous', id: idOf(o), reason: o.reason })),
    ...cov.uncertain.map((o) => ({ kind: 'uncertain', id: idOf(o) })),
    ...cov.codeOnly.map((o) => ({ kind: 'dead-button', id: idOf(o) })),
  ].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)),
  coveredIds: cov.covered.map(idOf).sort(),
});

export async function coverage(config, opts = {}) {
  const baseline = resolvePath(config, config.coverage.baseline || 'ci/expected.json');
  const { cov, wired } = await runCoverage(config, opts);
  const { findings, coveredIds } = reduce(cov);

  if (opts.selftest) { // seed regressions into the baseline (in memory) and assert the REAL diff would go red
    const base = existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')) : { findings: [], coveredIds: [] };
    const red = (b) => diffBaseline(b, findings, coveredIds).failed; // the same diff the live gate runs
    const a = red({ ...base, findings: base.findings.slice(1) });
    const b = red({ ...base, coveredIds: [...base.coveredIds, 'home/Canvas/Ghost::ghost'] });
    const c = red(base);
    console.log(`  [1] accepted finding removed  → ${a ? '✓ caught (red)' : '✗ MISSED'}`);
    console.log(`  [2] phantom covered button    → ${b ? '✓ caught (red)' : '✗ MISSED'}`);
    console.log(`  [3] pristine baseline control → ${!c ? '✓ green' : '✗ RED-ALWAYS'}`);
    const pass = a && b && !c;
    console.log(pass ? 'selftest: PASS — the gate fails when it should' : 'selftest: FAIL — the gate is not trustworthy');
    return { mode: 'coverage', selftest: true, summary: pass ? 'gate fails when it should, passes when it should' : 'gate not trustworthy', failed: !pass };
  }

  if (opts.update) {
    writeFileSync(baseline, JSON.stringify({ findings, coveredIds }, null, 2) + '\n');
    console.log(`baseline written: ${findings.length} accepted findings, ${coveredIds.length} covered`);
    return { mode: 'coverage', updated: true, summary: 'baseline updated', failed: false };
  }

  const base = existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')) : { findings: [], coveredIds: [] };
  const { baseIds, newFindings, regressed, failed } = diffBaseline(base, findings, coveredIds);
  console.log(`\n coir × copse coverage · ${config.url}\n wired ${wired} · covered ${cov.covered.length} · unreached ${cov.unreached.length} · accepted findings ${base.findings.length}`);
  for (const f of findings) console.log(`  ${baseIds.has(`${f.kind}|${f.id}`) ? '·' : '✗ NEW'} [${f.kind}] ${f.id}${f.blockedBy ? ` blockedBy=${f.blockedBy}` : ''}`);
  if (newFindings.length) console.log(` ✗ ${newFindings.length} NEW finding(s) not in the baseline`);
  if (regressed.length) { console.log(` ✗ ${regressed.length} covered button(s) REGRESSED:`); for (const r of regressed) console.log(`     ${r}`); }
  if (!failed) console.log(' ✓ matches the baseline — no regression');
  return { mode: 'coverage', url: config.url, wired, covered: cov.covered.length, findings, newFindings, regressed, summary: failed ? `${newFindings.length} new · ${regressed.length} regressed` : 'no regression', failed };
}
