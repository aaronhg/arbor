# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## What this is

**arbor** is the **AI-QA framework** for canvas games — the *control layer* that turns [coir](../coir)
(static analysis) and [copse](../copse) (runtime driver) into a test runner. Config-driven like
Playwright: a consumer writes one **`arbor.config.mjs`**, and `arbor <mode>` runs a zero-LLM coverage/visual
gate and (optionally) an LLM agent that drives the game and judges it against a design spec. Named for the
family: `coir` (coconut fibre) · `copse` (a stand of trees) · **`arbor`** (the tree).

arbor drives its siblings; it does not vendor them — copse/coir are resolved at runtime from the config
(`driver.copse` / `analyzer.coir`) or env (`COPSE_*` / `COIR_*`), through their PUBLISHED surface only.

## Responsibilities & boundaries

arbor is the **policy layer** of the family (`coir` · `copse` · `arbor`), split by one rule:
**needs project files → coir · needs a running game → copse · has judgment/policy → arbor.**

arbor OWNS everything that is a *decision* (what to test / whether it passed):
- **the loop** — `runLoop` (harness.mjs): plan → copse `execute` → judge → maybe iterate. arbor owns the
  loop shape AND the verdict; copse's `execute` only reports FACTS, arbor decides what they mean.
- **the coverage JOIN** — `coverageJoin` (join.mjs): coir's static clickmap × copse's runtime `clickSurface`
  → buckets (covered/blocked/unreached/ambiguous/…), diffed against a committed baseline.
- **test selection** — `affectedData` (select.mjs): which frozen flow tests a `coir impact` diff touches.
- **capability branching** — `requireCapability` (driver.mjs) over copse's declared `capabilities`
  (`clickSurface` / `stableRefs` / `reachability` / `visualManifest`), so a mode skips gracefully on an
  engine that can't support it (e.g. coverage is Cocos-only) instead of assuming Cocos.
- **the modes, config, reporters, and the eval store** — the whole runner surface.

arbor does NOT (it drives the siblings, never reimplements them):
- run the game / read live state → it calls **copse** (`execute`, `clickSurface`, `press`/`get`/…).
- read the project's files (scenes/prefabs/scripts) → it shells **coir** (`impact`, `clickmap`).

## Commands

```bash
npm test                                  # node:test — the pure functions + the harness
node --test test/join.test.mjs            # one test file
npx arbor init                            # scaffold arbor.config.mjs (buttons via coir clickmap) + qa/
npx arbor coverage [--update] [--selftest] [--headed]   # zero-LLM gate: coir clickmap × copse clickSurface vs baseline
npx arbor visual   [--update] [--headed]                # golden pixel signatures vs baseline (F9)
npx arbor gate     --patch <diff|-> [--headed]          # impact-scoped PR gate: impact → affected → copse run + coverage
npx arbor calibrate --runs N [--freeze] [--fail-on missed]   # AI: F4 explore · F6 judge · F5 freeze · F7 ×N over scenarios
npx arbor verify | orchestrate | impact | explore | agentic  # the other AI modes
```

Local runs use `--headed` on purpose: headless Chrome renders Cocos via SwiftShader (software WebGL) and
cooks the machine. CI is headless (ephemeral, heat irrelevant).

## Architecture

Two tiers, both config-driven off `arbor.config.mjs` (loaded by `src/config.mjs` — `defineConfig` +
walk-up `loadConfig` + config-relative `resolvePath`).

**Zero-LLM gate tier** (deterministic, CI-grade — no API key):
- `src/modes/coverage.mjs` — coir `clickmap` (static) × copse `clickSurface` (live, capability-gated) →
  **`join.mjs`** `coverageJoin` → reduce to buckets → diff a committed baseline (`diffBaseline`). Green
  normally, red on regression.
- `src/modes/visual.mjs` — golden per-node pixel signatures vs a baseline (copse `captureBaseline`/`visualCheck`).
- `src/modes/gate.mjs` — the impact-SCOPED gate: coir `impact` → **`select.mjs`** `affectedData` → replay the
  affected frozen tests via `copse run` + the coverage gate.

**AI tier** (needs an LLM seam — `src/llm.mjs`):
- `src/harness.mjs` — the reusable core: `runLoop` (arbor's loop over copse's `execute`), `runAgent`, the
  `agentFor` plan/judge agent, `toScript` (F5 freeze → a `copse run` tripwire), `aggregate` (F7 ×N stable/flaky).
- `src/modes/{calibrate,verify,orchestrate,impact,explore,agentic}.mjs` — the AI modes.
- `src/eval.mjs` (`outcomeJudge`, score findings vs ground-truth) + `src/evalstore.mjs` (`recordEval`, the
  detection-rate trend over time).

**The bridge to the siblings** (`src/driver.mjs`):
- `openDriver` → a copse session: `connect` + `engineReady` + `.capabilities`, returning `{ cp, execute, caps }`.
  `execute` is copse's deterministic fact primitive; arbor's `runLoop` drives it. Fails LOUD if the engine
  never installs (never a silent cocos-over-pixi hang).
- `pkgExport` / `pkgBin` — resolve copse/coir through their `exports` / `bin` maps (never a guessed internal
  file path). `copseCli` / `coirCli` shell the CLIs; env (`COPSE_CLI`/`COPSE_DRIVER`/`COPSE_HARNESS`/`COIR_CLI`)
  overrides for CI.
- `src/match.mjs` — `tailMatch`, the coir↔copse ref-matching vocabulary. A vendored MIRROR of copse's public
  `tailMatch` (arbor resolves copse dynamically, so it can't statically import it); `test/match.test.mjs`
  cross-checks the two copies against the single declared contract, so they can't drift.

`bin/arbor.mjs` is the CLI; `src/reporters/{console,json}.mjs` shape output; `src/init.mjs` scaffolds a config;
`src/webserver.mjs` starts/stops the game server (Playwright-style `webServer`).

## Conventions

- **Nothing about a game is baked in.** A consumer's `arbor.config.mjs` carries the game's `surface`, spec,
  scenarios, baselines, and the `driver.copse` / `analyzer.coir` locations. There are no fixture strings in `src/`.
- **copse reports facts; arbor decides.** Never re-add a pass/fail verdict to copse — the veto (drove-nothing /
  errored / unreachable → fail) is arbor's, computed from `execute`'s `facts` in `runAgent`/`runLoop`.
- **Branch on `caps`, don't assume cocos.** A mode that needs a capability calls `requireCapability(caps, …)`.
- **Test the pure functions.** `config` / `coverage`(`diffBaseline`/`reduce`) / `join` / `select` / `match` /
  `evalstore` / `pkg-resolve` are all unit-tested zero-LLM; the AI modes are validated by live smoke, not unit tests.
