# AI QA — experimental findings

What the AI layer (the **arbor** framework, opt-in) can and can't do, measured against this fixture's **four
planted bugs** (#1 disabled menu-Close, #2 dead Flee, #3 stale Floor label, #4 tally not reset on a
new run — see `assets/scripts/DungeonGame.ts`). The deterministic gate (`arbor coverage` / `visual` /
`gate` + `copse doctor`) is the product; this layer is a **research track**, and this is its
honest scorecard.

> **TL;DR.** Give an AI a *design spec* (an oracle) and it stops guessing; give it a *coordinator that
> decomposes the spec into pinned sub-tasks* and it reaches the deep-state bugs a single agent can't.
> Together they hit 4/4 with zero false positives — but only for behaviours the spec states (plus the
> obvious ones a strong model infers). Non-obvious requirements a terse spec omits become blind spots.

## The four modes

| mode | file | #1 | #2 | #3 | #4 | FP | the wall it hits |
|---|---|---|---|---|---|---|---|
| **Scripted** (hand-written goal + pins + oracle) | `arbor calibrate` | ✅ | ✅ | ✅ | 🟡 flaky | low | a human writes every scenario |
| **Free / divergent** (no goal, no pins, no oracle) | `arbor explore` | ✅ 3/3 | ✅ 2/3 | ⚠️ **misdiagnosed** | ❌ **missed 0/3** | **~5** | the **oracle problem** — noise, misattribution, blind to deep state |
| **Spec-grounded, one agent** | `arbor verify` | ✅ 3/3 | ✅ 1/3 | ⭕ untested | ⭕ untested | ~1 | one agent can't set up every deep precondition in one session |
| **Orchestrated** (coordinator + pinned workers + judge) | `arbor orchestrate` | ✅ | ✅ | ✅ | ✅ | **0** | fan-out adds an infra failure surface |

(Free/spec runs were Sonnet ×3; orchestrated used an Opus coordinator/judge + Haiku workers.)

## The arc — each mode removed the previous one's wall

1. **Free → spec.** Divergent exploration found the *surface* bugs (dead/disabled controls, a single
   press reveals them) but, with no oracle, it **misdiagnosed #3** (blamed "flee reset the floor"
   instead of the stale label), **missed #4** entirely (a die→restart it never triggered under live
   RNG), and emitted ~5 false positives (an RNG miss read as "attacks don't apply"; a settings menu
   not pausing combat). Handing it the design spec cut false positives **~5 → ~1** and stopped the
   misattribution — the noise *was* the missing oracle.

2. **Spec → orchestration.** One spec-grounded agent had the oracle but couldn't reach everything: in
   20–30 steps it verified the menu and flee, then honestly reported #3 and #4 as **untested** (it
   never descended / never died). **Decomposing into focused workers, each carrying its own RNG
   pins**, solved reachability — a worker whose only job is "pin the counter, drive to death, press
   Restart, read the tally" reliably catches #4.

3. **The catch.** Orchestration isn't free. In the first live workflow run a single shared bug — an
   `args`-passing failure — made 3 of 5 workers run `node undefined undefined` and abort, silently
   zeroing 60% of coverage (recall 2/4). The two workers that reached the game were precise (#2, #4,
   zero FP) and resourceful agents even *recovered* by reading files, but the judge's meta-point
   stands: **a single continuous agent would have sidestepped the per-task injection entirely.** More
   moving parts, more places to break. After the fix, the coordinator's own task specs for #1/#3 ran
   clean through the worker → effective **4/4, 0 FP**.

## The recipe that reached 4/4

> **spec** (oracle + goals) + **coir** (the static map of what's pinnable) → **coordinator**
> decomposes into pinned tasks → **focused workers** reach the state + verify → **judge** cross-checks.

coir closes the loop: the coordinator needs to know *how* to force a descend or a death (implementation
detail the spec — intent — doesn't carry). It found `rollCounter` / `rollDescend` / `rollMiss` by
reading the code; in production that's coir's static structure feeding the coordinator's pins.

## The boundary — the spec-shrink experiment

The coordinator step (now inside `arbor orchestrate`) can be run in isolation. Fed the **full** spec it emits 12 tasks including
sharp #3/#4 checks. Fed a **minimal** spec (`tiny-dungeon-spec-min.md`, which still names Floor and
Restart but drops their correctness clauses) it emits 8 — and the two deep bugs split:

| bug | full spec task | minimal spec task | result |
|---|---|---|---|
| #3 floor desync | `floor-...-label-updates-live` ("never lags") | `kill_descends_floor...` — **"Floor updates on a kill" (inferred)** | ⚠️ survives, via inference |
| #4 tally reset | `restart-resets-run` ("Defeated **reset to 0**") | `game_over_restart_resets_run` — only "**starts a fresh run**" | ❌ **blind** — oracle lost |

**The blind spot is real but selective.** Remove an *obvious* property (a label reflects live state)
and a strong model re-infers it → #3 survives. Remove a *non-obvious* one (a specific counter resets
independently across runs) and it's gone the moment it's unstated → #4 goes blind: no task, no oracle,
no chance. That is exactly why **#4 was the interesting bug all along** — the tally-reset is the kind
of subtle requirement a terse real spec drops *and* the model won't guess.

> **Spec-driven coverage = the spec + the obvious inferences.** Terser spec, bigger blind spots.

## Honest limits (what this demo does NOT show)

- **"Finds unknown bugs" is unmeasurable here.** The fixture has exactly 4 known bugs and no
  unplanted ones, so no mode could find "a bug outside the script" — there isn't one. Free
  exploration's only out-of-script hits (menu-doesn't-pause, `.hp` reads 3 after death) turned out to
  be **by-design**, not defects. Measuring discovery needs a fixture with an unplanted bug, or a real
  game.
- **Spec-driven finds *spec violations*, not "bugs."** Whether it catches something depends on a spec
  claim forbidding it — not on it being one of the planted four (here they coincide).
- **Orchestration adds fragility and cost** (tokens ≈ 1 coordinator + N workers + judge). Justify the
  fan-out; a single continuous agent has less to go wrong.

## The files

Since these findings, the harness was refactored into the **`arbor`** framework (see
[`../arbor/README.md`](../arbor/README.md)) — the reusable engine, fixture-agnostic, driven by
`arbor.config.mjs`. Each research mode above is now an `arbor` sub-command / module:

| arbor | was | what |
|---|---|---|
| `arbor calibrate` · `src/modes/calibrate.mjs` | `ci/ai-qa.mjs` | scenario matrix (F4 explore · F6 judge · F5 freeze · F7 ×N) |
| `arbor explore` · `src/modes/explore.mjs` | `ci/ai-qa-explore.mjs` | free / divergent probe (no goal, no oracle) |
| `arbor verify` · `src/modes/verify.mjs` | `ci/ai-qa-spec.mjs` | spec-grounded, single agent (`--min` = the reduced-spec blind-spot run) |
| `arbor orchestrate` · `src/modes/orchestrate.mjs` | workflow + `ai-qa-{task,decompose}.mjs` | coordinator decompose → pinned workers → judge (the worker/coordinator, once separate probes, are now in-process here) |
| `arbor impact` · `src/modes/impact.mjs` | `ci/ai-qa-impact.mjs` | F1→F4 — a diff drives the run |
| `src/harness.mjs` + `src/harness.test.mjs` | `ci/ai-qa.{mjs,test.mjs}` | the engine core (runAgent · toScript(F5) · aggregate(F7)) + its zero-LLM tests |
| `src/llm.mjs` | (in `ai-qa.mjs`) | the one LLM seam (API / claude -p / skip) |
| `ci/qa/tiny-dungeon.spec.md`, `.spec.min.md` | `ci/tiny-dungeon-spec*.md` | the design spec (intent) + a deliberately reduced one |
