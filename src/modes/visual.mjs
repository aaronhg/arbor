// arbor · visual (zero-LLM, F9) — golden pixel signatures vs a committed baseline. `--update` captures
// the golden set (copse captureBaseline); the default run re-captures live and flags any node whose
// rendering drifted / stopped drawing. Catches what the coverage join can't: a wired, reachable button
// rendering blank or with the wrong sprite.
import { readFileSync, writeFileSync } from 'node:fs';
import { openDriver, requireCapability } from '../driver.mjs';
import { resolvePath } from '../config.mjs';

export async function visual(config, opts = {}) {
  const baselineFile = resolvePath(config, config.visual.baseline || 'ci/visual-baseline.json');
  const refs = opts.refs ? String(opts.refs).split(',').map((s) => s.trim()) : config.visual.refs;
  const { cp, caps } = await openDriver(config, { headed: opts.headed });
  try {
    requireCapability(caps, 'visualManifest', 'visual'); // branch on the engine, not an assumption
    await cp.reload();
    if (opts.update) {
      const golden = await cp.captureBaseline(refs ? { refs } : {});
      const keys = Object.keys(golden);
      if (!keys.length) return { mode: 'visual', summary: 'captured 0 signatures — nothing drew, or the refs are wrong', failed: true };
      writeFileSync(baselineFile, JSON.stringify(golden, null, 0) + '\n');
      console.log(`captured ${keys.length} golden signature(s): ${keys.join(', ')}`);
      return { mode: 'visual', updated: true, summary: `captured ${keys.length} golden signatures`, failed: false };
    }
    const golden = JSON.parse(readFileSync(baselineFile, 'utf8'));
    const entries = Object.entries(golden).filter(([ref]) => !refs || refs.includes(ref));
    let drift = 0;
    console.log(`── visual baseline check — ${entries.length} node(s) ─────────────`);
    for (const [ref, sig] of entries) {
      const v = await cp.visualCheck(ref, { baseline: sig });
      const ok = v.matches === true; if (!ok) drift++;
      console.log(`  ${ok ? '✓' : '✗'} ${ref.padEnd(28)} drawn=${v.drawn} matches=${v.matches} via=${v.via}${v.drawn === false ? '  (STOPPED DRAWING)' : ''}`);
    }
    return { mode: 'visual', url: config.url, checked: entries.length, drift, summary: drift ? `${drift}/${entries.length} node(s) drifted from the golden baseline` : `all ${entries.length} node(s) match the golden baseline`, failed: drift > 0 };
  } finally { await cp.close(); }
}
