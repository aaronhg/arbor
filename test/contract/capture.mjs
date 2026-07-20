// Regenerate the coir golden fixtures from the demo project. Run this when coir's `-o json` output shape
// LEGITIMATELY changes (a coir release), then commit the diff — the diff IS "what changed about v1", and the
// contract test (coir-shape.test.mjs) then tells you whether arbor still consumes the new shape.
//
//   node test/contract/capture.mjs                 # coir + demo adjacent under the same parent
//   COIR_CLI=… CONTRACT_PROJECT=… node …           # or point at them explicitly (what coir's reversed CI does)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');                                 // /repo (arbor is /repo/arbor)
const COIR = process.env.COIR_CLI || join(REPO, 'coir/src/cli.js');
const PROJ = process.env.CONTRACT_PROJECT || join(REPO, 'coir-copse-demo');
const run = (args) => JSON.parse(execFileSync('node', [COIR, '-C', PROJ, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const pp = (o) => JSON.stringify(o, null, 2) + '\n';                    // pretty → git-diffable

writeFileSync(join(HERE, 'fixtures/coir-clickmap.json'), pp(run(['clickmap', 'scene/fixture.scene', '-o', 'json'])));
writeFileSync(join(HERE, 'fixtures/coir-impact.json'), pp(run(['impact', 'assets/scripts/DungeonGame.ts', '-o', 'json'])));
console.log('captured coir goldens → test/contract/fixtures/  (clickmap + impact)');
