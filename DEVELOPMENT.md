# DEVELOPMENT

Working notes for arbor itself — the *why* behind the layout, the contracts with coir/copse, and the
traps that already bit us. For "what arbor is / how to use it" see [`README.md`](README.md); for the
boundary rules see [`CLAUDE.md`](CLAUDE.md).

## 1. The one idea

arbor is the **policy layer**. coir supplies static facts (it reads project files), copse supplies runtime
facts (it drives a live game), and **every decision is arbor's**: what to test, what a fact means, whether
a run passed. That single rule decides where new code goes:

> needs project files → **coir** · needs a running game → **copse** · has judgment/policy → **arbor**

If you find yourself adding a verdict to copse or a file-parser to arbor, stop — it's in the wrong repo.

## 2. Layout

```
bin/arbor.mjs        the CLI: parse flags -> loadConfig -> run a mode -> reporters -> exit code
src/config.mjs       defineConfig (defaults) + loadConfig (walk-up) + resolvePath (config-relative)
src/driver.mjs       THE BRIDGE: openDriver (copse session + caps + execute), pkgExport/pkgBin,
                     copseCli/coirCli, applyPins, requireCapability
src/harness.mjs      runLoop (arbor's loop over copse's execute), runAgent, agentFor (plan/judge),
                     toScript (F5 freeze), aggregate (F7), compactSteps
src/join.mjs         coverageJoin — the coir x copse JOIN (moved out of copse)
src/select.mjs       affectedData + drivenPaths — which frozen tests a diff touches (moved out of copse)
src/match.mjs        tailMatch — the coir<->copse ref vocabulary (a MIRROR of copse's; see §6)
src/llm.mjs          the LLM seam (model, usage accounting, JSON extraction)
src/eval.mjs         outcomeJudge — score findings against a ground-truth bug list
src/evalstore.mjs    recordEval — append-only JSONL trend of detection rate over time
src/init.mjs         scaffold an arbor.config.mjs (buttons discovered via coir clickmap)
src/webserver.mjs    Playwright-style webServer: start/stop (or reuse) the game server
src/modes/*.mjs      the runnable modes (§4)
src/reporters/*.mjs  console + json output shaping
```

`src/index.mjs` is the public barrel (`defineConfig` + the mode registry the CLI reads).

## 3. The two tiers

**Zero-LLM gate tier** — deterministic, no API key, safe on every PR:
- `coverage` — coir `clickmap` (static) × copse `clickSurface` (live) → `coverageJoin` → buckets →
  `diffBaseline` against a committed baseline. `--update` reseeds; `--selftest` proves the gate can go red.
- `visual` (F9) — golden per-node pixel signatures vs a baseline.
- `gate` (F2/F3) — the impact-SCOPED PR gate: `coir impact` → `affectedData` → replay only the affected
  frozen tests via `copse run` + the coverage gate. Empty risk set → skip entirely.

**AI tier** — needs `ANTHROPIC_API_KEY` (or the `claude` CLI for `agentic`):
- `calibrate` — the measurement rig: F4 explore · F6 judge · F5 freeze · F7 ×N over the config's planted
  scenarios, reporting a detection rate. This is how you tell whether a prompt/model change helped.
- `verify` — spec-grounded: the design spec is the oracle; report where reality violates it.
- `orchestrate` — a coordinator assigns goals + RNG pins to workers, then judges.
- `impact` — drive only the buttons a diff touched.
- `explore` (F8) — no goal, no oracle: free divergent hunting. Noisy by construction.
- `agentic` — hand the whole loop to `claude -p` over copse's MCP. The road *not* taken by the other modes.

## 4. The loop, and why copse doesn't own it

`runLoop(cp, execute, agent, opts)` is ~20 lines: snapshot → `agent.plan` → `execute(cp, steps)` →
`agent.judge` → maybe iterate, accumulating `facts` across rounds.

The important part is what it *doesn't* do. copse's `execute` returns `{steps, facts}` where facts are
`unreachable / errored / undriven / uncertain / visual` — **observations, not a verdict**. arbor decides
what they mean, in `runAgent`:

- `facts.errored` (a handler threw / logged) and `facts.undriven` (a press drove nothing) → a detection.
- `facts.unreachable` → a detection *for gate-kind scenarios*.
- A copse USAGE error (the agent wrote a malformed selector) is **inconclusive**, not a defect — see the
  `USAGE_ERR` regex in `harness.mjs`. Conflating the two was a real early bug: the agent flubbing the test
  read as the game being broken.

Consequence: never re-add a pass/fail to copse. If you want a different veto, change `runAgent`.

## 5. The bridge to copse/coir (`driver.mjs`)

Resolution is **config path → env → sibling default**, and always through the sibling's *published*
surface — `pkgExport` reads its `exports` map, `pkgBin` reads its `bin` map. Never reach at an internal
file path: if copse renames a file, its export map still points true, and if arbor asks for a subpath that
isn't exported, it fails loud (that's the coupling we removed).

Env overrides (used by CI): `COPSE_CLI` · `COPSE_DRIVER` · `COPSE_HARNESS` · `COIR_CLI` · `ARBOR_BIN`.

**Capabilities.** copse declares `{engine, clickSurface, stableRefs, reachability, visualManifest}` on the
session; `openDriver` returns it as `caps` and modes branch via `requireCapability`. This exists because
arbor silently assumed Cocos: `coverage` is Cocos-only (Pixi serializes no click handlers), and F5 freeze
needs `stableRefs` (Pixi refs are positional, so a frozen tripwire can't replay). `openDriver` also **fails
loud** when the engine never installs, instead of hanging on a cocos bundle over a pixi game.

### Trap: the config's own import is a static path

`arbor.config.mjs` does `import { defineConfig } from '../arbor/src/index.mjs'` — static, so **no env can
redirect it**. `ARBOR_BIN` only covers the CLI invocation. This bit us the first CI run after extraction:
arbor was cloned to `/tmp/arbor`, `../arbor` didn't exist, `ERR_MODULE_NOT_FOUND`. The fix is to make the
runner mirror the local layout — clone arbor as a **sibling of the checkout**
(`"$GITHUB_WORKSPACE/../arbor"`). If arbor is ever npm-published, `from 'arbor'` removes the trap entirely;
alternatively `loadConfig` could apply `defineConfig` itself so a consumer's config needs no import at all.

## 6. `match.mjs` is a deliberate duplicate

`tailMatch` (does a coir static nodePath correspond to a copse runtime ref?) exists **twice**: here, and in
copse (`src/coverage.js`, for its `resolveCoirPath`/`resolveCopseRef` adapters). arbor resolves copse
*dynamically* from config, so it can't statically import copse's copy, and both sides genuinely need it.

It's a ~15-line, stable, contract-defined function, so a vendored mirror beats a shared micro-package. Drift
is prevented mechanically: copse exports `tailMatch` publicly and `test/match.test.mjs` **cross-checks the two
implementations** over a shared case list. If either side changes behaviour, that test goes red. Don't
"tidy" it by deleting one copy without re-solving the resolution problem.

## 7. Testing

`npm test` (node:test). The rule: **the pure functions are unit-tested; the AI modes are validated by live
smoke**, because their value is empirical, not assertable.

| file | pins |
|---|---|
| `test/config.test.mjs` | defaults, walk-up load, config-relative resolution |
| `test/coverage.test.mjs` | `reduce` (buckets) + `diffBaseline` — the certified-can-go-red verdict |
| `test/join.test.mjs` | the 14 `coverageJoin` bucket cases (moved with the function from copse) |
| `test/select.test.mjs` | `affectedData` / `drivenPaths` — PR test selection |
| `test/match.test.mjs` | `tailMatch` + the **cross-check against copse's public one** |
| `test/capabilities.test.mjs` | `requireCapability` branching |
| `test/pkg-resolve.test.mjs` | `pkgExport`/`pkgBin` against the REAL copse/coir manifests |
| `test/evalstore.test.mjs` | both record shapes (outcome-judged and calibrate) |
| `src/harness.test.mjs` | `toScript` (F5) + `aggregate` (F7) |

`pkg-resolve` and `match` read the sibling checkouts; both skip gracefully if copse/coir aren't adjacent.

Local runs use `--headed` on purpose: headless Chrome renders Cocos through SwiftShader (software WebGL)
and cooks the machine. CI is headless — ephemeral, so heat is irrelevant.

## 8. Findings worth not re-learning

Written up in [`docs/AI-QA-FINDINGS.md`](docs/AI-QA-FINDINGS.md); the short version:

- **A spec fixes the oracle problem.** Without one the agent invents expectations (false positives, and
  worse, confident misdiagnosis). With one, FPs collapse.
- **Pins beat autonomy for deep state.** Hand-authored RNG pins reach die→restart bugs that free
  exploration and even a fully autonomous `claude -p` agent miss.
- **A shrunk spec produces selective blindness** — obvious properties are still inferred, non-obvious ones
  go completely unseen. Spec coverage, not spec length, is what matters.
- **N-run aggregation is mandatory.** Single runs are flaky enough to mislead; `calibrate --runs N` with a
  majority vote (F7) is the only honest measurement.
