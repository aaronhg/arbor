// arbor · json reporter — the machine-readable audit bundle. The path resolves against the CONFIG dir
// (repo root), not cwd, so it lands in the same place whether arbor is run from repo root or ci/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolvePath } from '../config.mjs';

export function report(result, opts = {}) {
  const rel = opts.out || process.env.ARBOR_REPORT || `ci/results/arbor-${result.mode}.json`;
  const out = opts.config ? resolvePath(opts.config, rel) : rel;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(`  report → ${out}`);
}
