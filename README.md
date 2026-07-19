# arbor

**AI QA for canvas games.** An LLM agent drives your Cocos build and judges it against a design spec —
catching the *semantic* bugs a coverage gate can't see (a label that lies, a tally that never resets).
It sits on **[coir](../coir)** (static analysis → what a diff impacts, what's pinnable) and
**[copse](../copse)** (runtime driver → real Chrome, ref-based).

Named for the family: `coir` (coconut fibre) · `copse` (a stand of trees) · **`arbor`** (the tree).

## Getting started

```bash
npx arbor init                 # scaffolds arbor.config.mjs (buttons auto-discovered via coir clickmap) + qa/
# fill in webServer.command + surface, then:
npx arbor coverage --update    # seed the baseline
npx arbor coverage             # the zero-LLM gate is live
```

## The shape (like Playwright / Jest)

Nothing about your game is baked into arbor. You write one **`arbor.config.mjs`** (`arbor init` scaffolds
it) and your scenarios; arbor provides the runner — and, like Playwright's `webServer`, starts/stops
your game server for you.

```js
// arbor.config.mjs
import { defineConfig } from 'arbor';            // (in-repo: './arbor/src/index.mjs')
import { scenarios } from './ci/qa/scenarios.mjs';

export default defineConfig({
  url: 'http://127.0.0.1:8899/',                     // the served game
  webServer: { command: 'node ci/serve.mjs 8899',    // arbor starts it, waits, and stops it after
               reuseExisting: true },                // (reuses a dev server if one's already up)
  driver:   { copse: '../copse' },    // runtime driver
  analyzer: { coir:  '../coir'  },    // static analyzer (for `impact`)
  scene:    'scene/fixture.scene',    // for the coverage gate
  surface:  `…how to drive THIS game (refs/sels)…`,
  spec:     './ci/qa/tiny-dungeon.spec.md',   // the oracle
  scenarios,                          // calibration scenarios (planted-bug goals + RNG pins)
  reporters:['console', 'json'],
});
```

## Modes

```
arbor calibrate [--runs N] [--freeze]   # scenario matrix → detection rate; --freeze → regression tripwires
arbor verify   [--min]                   # spec-grounded single agent (violations vs the spec)
arbor orchestrate                        # coordinator decomposes the spec → pinned workers → judge
arbor impact --patch <diff>              # a DIFF drives the run (coir impact scopes it)
arbor explore                            # free divergent probe (no goal/oracle) — experimental
```

The one LLM seam (`src/llm.mjs`): Anthropic API if `ANTHROPIC_API_KEY` is set, else local `claude -p`,
else the mode is skipped. Model via `model:` in config or `ANTHROPIC_MODEL` / `--model`.

## Layout

```
src/
  index.mjs      defineConfig + run(mode)      config.mjs   defineConfig + loader
  llm.mjs        the API / claude -p / skip seam
  harness.mjs    runAgent · judge · toScript (freeze) · aggregate (N-run vote)
  driver.mjs     connect via copse · apply RNG pins
  modes/         calibrate · verify · orchestrate · impact · explore
  reporters/     console · json
bin/arbor.mjs    the CLI
```

## Findings

What this approach can and can't do — the four-mode comparison, the oracle/reachability arc, and the
spec-shrink blind-spot experiment — is written up in
[`docs/AI-QA-FINDINGS.md`](../docs/AI-QA-FINDINGS.md).
