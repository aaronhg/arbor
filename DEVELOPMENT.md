# Development History — arbor (AI QA for canvas games)

How this project actually happened: what was tried, what was measured, what was wrong, and why the
boundaries ended up where they are. For usage see [`README.md`](README.md); for the rules that govern
where code goes see [`CLAUDE.md`](CLAUDE.md).

---

## 0. The Goal in One Sentence

Catch the bugs a coverage gate structurally cannot see — a label that lies, a tally that never resets —
by having an LLM **drive a real canvas game and judge it against a design spec**, cheaply and repeatably
enough to run in CI.

---

## 1. Where It Came From

arbor was not designed; it **precipitated**. It began as a pile of hand-rolled scripts inside the demo
repo's `ci/` folder — `gate.mjs`, `pr-gate.mjs`, `selftest.mjs`, `ai-qa.mjs`, `ai-qa.test.mjs` — each
wiring [coir](../coir) (static analysis) and [copse](../copse) (runtime driver) together for one purpose.
They worked, but every new capability meant another bespoke script with its own copy of "find coir, find
copse, connect, drive, decide".

### 1.1 The F-numbered backlog

Work was tracked against a canvas-AI-testing backlog, F1–F12. The numbers still appear in the code and
the mode help, so they're worth keeping straight:

| | |
|---|---|
| F1–F3 | the deterministic layer: coverage join, impact-scoped gate, PR scoping |
| **F4** | *explore* — an LLM plans a test from a goal |
| **F5** | *auto-freeze* — turn a stable finding into a replayable tripwire |
| **F6** | *judge* — an LLM decides pass/fail from observed state |
| **F7** | *uncertainty control* — run N times, majority vote |
| F8 | free divergent probing (no goal, no oracle) |
| F9 | visual golden signatures |
| F10–F12 | later: orchestration, spec grounding, evaluation |

---

## 2. The First Two Features: F5 + F7

F5 (freeze) and F7 (N-run aggregation) were built first, validated against the demo's four **planted**
bugs (a dead button, a floor/label desync, a defeat tally that doesn't reset, a disabled menu control).

### 2.1 Why F7 turned out to be a prerequisite, not a nicety

A single LLM run is flaky enough to be actively misleading — the same scenario would detect on one run and
miss on the next. Any claim of the form "the agent finds bug X" is meaningless without N runs and a
majority vote. **F7 stopped being a feature and became the measurement instrument**: every later claim in
this document is an aggregate, never a single run.

### 2.2 Three real bugs the full matrix surfaced

Running the whole scenario matrix (rather than one scenario at a time) exposed three defects in our own
harness — all of them the same species: *treating an uncertain result as a certain one*.

1. **Greedy JSON extraction.** The plan/verdict parser used a greedy regex over the model's reply, which
   silently mangled nested objects. Replaced with balanced-brace extraction.
2. **The judge conflated "inconclusive" with "detected".** If the agent never actually set up the
   precondition (never drove the hero to 0 hp), the run proved nothing — but it was being scored as a
   detection. Fixed by making the verdict a three-way `bug | inconclusive | ok`, and by ruling that a
   *disabled or dead control is a bug, not an inconclusive* (that distinction matters: it's the difference
   between "the test failed to run" and "the thing under test is broken").
3. **F5 froze from an inconclusive run.** The freeze step was serialising whichever run it had, including
   inconclusive ones — producing tripwires that asserted nonsense. Now an exemplar is taken **only from a
   conclusive judge-`bug` run**, and structural (gate-kind) findings only count for gate-kind scenarios.

The lesson generalises: in an LLM harness, *every* place that collapses three states into two is a bug
waiting to be believed.

---

## 3. Taking It to CI

The loop was moved behind the Anthropic API directly (no SDK), then wired into an **opt-in** GitHub
Actions workflow — manual dispatch only, never on every PR, because it spends tokens. The always-on floor
stayed the zero-LLM gate. The workflow emits a rendered detection table plus a complete evidence artifact
(full log, machine-readable report with every plan/trace/verdict, and any frozen candidate tripwires).
Cost was trialled on Haiku deliberately: if the cheapest model can carry the flow, the flow is sound.

---

## 4. The Experiments That Shaped the Design

This is the part worth reading. The architecture is a *consequence* of these results.

### 4.1 F8 — free divergence

Give the agent no goal, no oracle, no pins: just "explore and report what looks wrong." It finds surface
bugs (a dead button) reliably and then generates **noise** — because with no oracle it must invent its own
expectations, and invented expectations produce confident false positives. Kept as a mode, but framed
honestly in the docs as *data about the gap*, not a gate.

### 4.2 Orchestration — a coordinator with pins

A coordinator assigns each worker a goal **plus the RNG pins that make the target state reachable**. This
was the breakthrough for depth: the pinned/orchestrated runs reached the deep-state bugs (die → restart →
read the tally) that free exploration never got near.

### 4.3 The spec as oracle

Feeding the design spec in as the oracle was the single largest quality jump: **false positives collapsed
(~5 → ~1) and confident misdiagnosis stopped**. The agent no longer had to guess what "correct" meant. This
is why `verify` exists and why `spec` is a first-class config field.

### 4.4 Shrinking the spec — the blind-spot probe

Deliberately cutting the spec down and re-running produced the most useful negative result: the blindness
is **selective, not proportional**. Obvious properties the agent can infer from the surface it still
catches; non-obvious ones it goes *completely* blind to — no partial credit, no hedged report. So spec
**coverage** is what buys detection, not spec length.

### 4.5 Full autonomy as the control

`agentic` hands the entire loop to `claude -p` driving copse's MCP tools, unconstrained. Result: **2/4 at
$0.78 across 46 turns** — respectable, but it did *not* beat the constrained loop with hand-authored pins
on the deep-state bugs. Conclusion, and the reason arbor constrains the LLM to plan+judge rather than
letting it drive: **reach comes from pins, not from autonomy.** Kept as a mode precisely because it's the
honest control condition.

---

## 5. From Scripts to a Framework

With the experiments settled, the `ci/*.mjs` pile was the bottleneck. The rewrite took the shape of a
real test framework rather than a script collection.

### 5.1 Naming

The family already had `coir` (coconut fibre) and `copse` (a stand of trees). Candidates were floated and
rejected until **`arbor`** — the tree — which fits the family and says "the thing the others grow into".

### 5.2 The Playwright shape

Deliberately modelled on `playwright.config`: one **`arbor.config.mjs`** in the consumer's project
(`defineConfig`, walk-up discovery, config-relative paths), a `arbor <mode>` CLI, pluggable reporters
(console/json), an `init` scaffold, and a `webServer` block that starts/stops (or reuses) the game server.
Nothing about any specific game lives in `src/` — the game's surface, spec, scenarios and baselines are all
config.

### 5.3 Folding the deterministic gate in

The zero-LLM scripts were folded in as first-class modes (`coverage`, `visual`, `gate`) rather than left
outside, so the same config, reporters and exit-code contract serve both tiers. That's what makes "AI tier
optional" true in practice: a project can adopt arbor with no API key at all.

---

## 6. Borrowings from a Sibling Harness (gstack)

Reviewing a mature agent-eval harness produced four adoptions, all about *measuring the measurer*:

- **`outcomeJudge`** — score a run's findings against a ground-truth bug list → detection rate, misses,
  false positives, evidence quality. Without this, "it found bugs" is unfalsifiable.
- **eval store** — append-only JSONL of every judged run, so a model swap or prompt tweak shows up as a
  trend rather than a vibe.
- **threshold gate** — `--min-detection` / `--min-evidence` turn the score into an exit code.
- **cost tracking** — tokens and dollars reported per run.

---

## 7. The Code Review

A high-effort review of the assembled framework found **nine wiring bugs**; eight were fixed (the ninth
was accepted as intended behaviour). The instructive ones:

- `coverage`/`visual`/`gate` were invoking the **LLM** outcome judge — the zero-LLM tier wasn't zero-LLM.
- The `webServer` teardown killed the shell but not its **child**, leaving the server alive.
- `flag()` returned `true` for value-flags, so `--runs` silently became `1`.
- `--selftest` validated a **duplicated copy** of the diff, not the one the live gate runs — the certified
  "this gate can go red" was certifying the wrong code.
- `agentic` swallowed a missing `claude` CLI into a **fake 0/4 result** instead of failing loud.

Pattern: every one of them was a place where a failure could masquerade as a pass. That is the failure
mode this whole project exists to prevent, so finding them in our own code was appropriate.

---

## 8. The Boundary Refactor

By this point three tools were entangled: copse had grown a coverage join, a test-selection verb, and a
whole AI loop; arbor reached into copse's *internal file paths*. A boundary review triggered a planned
relocation.

### 8.1 The mechanical rule

One rule, applied without exception:

> needs project files → **coir** · needs a running game → **copse** · has judgment/policy → **arbor**

Applied to the coverage join, it says: coir supplies the static surface, copse supplies the runtime
surface, and the **join needs neither** — it's pure reconciliation over two inputs, i.e. control-layer
work. So the join belongs in arbor, and copse's `coverage` verb was a leak.

### 8.2 Phase 0 — the safety net first

arbor was ~1000 lines with a single 72-line test file. Before moving anything, unit tests were backfilled
for exactly the code the move would touch (config resolution, the coverage diff, the eval store). Every
later phase landed against a green suite.

### 8.3 Phase 1 — session capabilities

arbor was silently assuming Cocos. copse now **declares** `{engine, clickSurface, stableRefs, reachability,
visualManifest}` on the session; arbor branches on it (`requireCapability`) and fails loud when the engine
never installs. This fixed a real latent bug rather than merely tidying: `coverage` is Cocos-only (Pixi
serialises no click handlers) and F5 freeze needs stable refs (Pixi refs are positional).

### 8.4 Phase 2 — published surfaces, not file paths

arbor had been importing `copse/src/drivers/puppeteer.js` — an internal path, i.e. a hidden API. Replaced
with resolution through the sibling's **`exports` / `bin` maps** (`pkgExport` / `pkgBin`), so a rename on
copse's side can't silently break arbor, and asking for a non-exported subpath fails loudly.

### 8.5 Phase 3 — `affected` moves to arbor

Test selection (which frozen tests a diff touches) needs neither files nor a live game → arbor. copse's
`affected` CLI verb and MCP tool were deleted.

### 8.6 Phase 4 — the coverage JOIN moves to arbor

`coverageJoin` + its 14 bucket tests moved out of copse; copse's `coverage` CLI verb, MCP tool and public
export were deleted, keeping only `clickSurface` (the runtime half). The proof that this was
behaviour-preserving: the demo's coverage output was **byte-identical** before and after.

### 8.7 Phase 5 — inverting the AI loop

The last and largest. Reading copse's `runHarness` closely changed the plan: it was *already*
policy-agnostic (arbor injected the agent, configured the gates, and computed its own verdict — it never
read copse's `pass`). So the first proposal was a light touch. On review that was judged too timid: copse
should hold **no dynamic/AI parts at all**. Final shape:

- copse gained **`execute(driver, steps) → {steps, facts}`** — run a step list, report
  `unreachable / errored / undriven / uncertain / visual`. **No agent, no loop, no verdict.**
- copse **lost** `runHarness`, the `claude -p` agent, and the `copse ai` CLI.
- arbor gained **`runLoop`** — its own loop over `execute` — and owns the veto outright.

The line that matters: **copse reports facts; arbor decides what they mean.**

---

## 9. Extraction Into Its Own Repo

arbor had been living inside the demo (`coir-copse-demo/arbor/`). It was moved out to sit beside coir and
copse as a peer, taking its docs (`AI-QA-FINDINGS.md`, `CI.md`) with it.

### 9.1 The reference model

The demo consumes all three as siblings, resolved **relative + env**: the config imports from `../arbor`
and names `../copse` / `../coir`; CI clones each and overrides via `ARBOR_BIN` / `COPSE_CLI` /
`COPSE_DRIVER` / `COPSE_HARNESS` / `COIR_CLI`. Deliberately *not* npm `file:` deps — the demo's root
`package.json` is a Cocos Creator manifest, and bolting npm dependency management onto it mixes concerns.

### 9.2 The trap that broke the first CI run

`arbor.config.mjs` imports `defineConfig` from `'../arbor/src/index.mjs'` — a **static** path, so no env
var can redirect it. `ARBOR_BIN` covered the CLI but not the config's own import, and CI had cloned arbor
to `/tmp/arbor`: `ERR_MODULE_NOT_FOUND`. Fix: have CI clone arbor as a **sibling of the checkout**
(`"$GITHUB_WORKSPACE/../arbor"`) so the runner mirrors the local layout. If arbor is ever npm-published,
`from 'arbor'` removes the trap; alternatively `loadConfig` could apply `defineConfig` itself so a
consumer's config needs no import at all.

---

## 10. Pitfalls Worth Not Re-Learning

- **A press that drove nothing is not a pass.** `drove:'nothing'` must be a hard finding; a `fired:0`
  misread as success is the exact trap the fact layer closes.
- **An agent's own malformed selector is *inconclusive*, not a defect.** The `USAGE_ERR` filter in
  `harness.mjs` exists solely to keep the agent flubbing its test from reading as the game being broken.
- **`match.mjs` duplicates copse's `tailMatch` on purpose.** arbor resolves copse dynamically, so it
  cannot statically import it, and both sides need it. Drift is prevented *mechanically* — copse exports
  `tailMatch` publicly and `test/match.test.mjs` cross-checks the two implementations. Don't delete a copy
  without re-solving the resolution problem.
- **Never re-add a verdict to copse.** If the veto needs changing, change `runAgent`.
- **Local runs use `--headed` deliberately** — headless Chrome renders Cocos through SwiftShader (software
  WebGL) and cooks the machine. CI is headless because it's ephemeral.

---

## 11. Final State

A config-driven framework with two tiers over a clean three-way boundary:

- **Zero-LLM gate** — `coverage` (coir clickmap × copse clickSurface, joined here, diffed against a
  committed baseline), `visual` (golden signatures), `gate` (impact-scoped PR gate). No API key required.
- **AI tier** — `calibrate` (the measurement rig: F4·F5·F6·F7), `verify` (spec as oracle), `orchestrate`
  (coordinator + pins), `impact`, `explore` (F8), `agentic` (the autonomy control).
- **Boundary** — coir reads files, copse drives a live game and reports facts, arbor owns the loop, the
  verdict, the join, test selection and capability branching.
- **Tests** — the pure functions are unit-tested (config, coverage diff, join, select, match + the
  cross-check, capabilities, package resolution, eval store, F5/F7); the AI modes are validated by live
  smoke, because their value is empirical rather than assertable.
