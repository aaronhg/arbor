// arbor · harness — the reusable core: an agent (F4 plan / F6 judge) driving copse's `execute` (the
// deterministic FACT primitive), plus the finding normaliser, F5 freeze (toScript), and F7 aggregate.
// arbor OWNS the loop (runLoop) and the verdict — copse.execute reports facts, arbor decides what they
// mean (it does NOT use copse's runHarness gate `pass`). The game's `surface` is a PARAMETER.
import { llm } from './llm.mjs';

// arbor's loop over copse's `execute`: discover → plan → execute → judge → maybe iterate. Returns the
// same `rounds` shape the modes read, plus the facts accumulated across rounds. This is arbor's own loop
// (not copse's runHarness): copse supplies the fact rail, arbor owns the loop shape and the verdict.
export async function runLoop(cp, execute, agent, opts = {}) {
  const { context = null, maxRounds = 1 } = opts;
  const rounds = [];
  const facts = { unreachable: [], errored: [], undriven: [], uncertain: [], visual: [] };
  let snapshot = await cp.snapshot();
  for (let round = 0; round < maxRounds; round++) {
    const plan = (await agent.plan({ context, snapshot, rounds, round })) || { steps: [] };
    const trace = await execute(cp, plan.steps || []);
    const verdict = await agent.judge({ context, snapshot, plan, steps: trace.steps, rounds, round });
    rounds.push({ round, rationale: plan.rationale, steps: trace.steps, verdict });
    for (const k of Object.keys(facts)) facts[k].push(...(trace.facts[k] || []));
    if (!agent.next) break;                       // default policy: one round
    const cont = await agent.next({ context, snapshot, rounds, round });
    if (!cont || !cont.continue) break;
    if (round < maxRounds - 1) snapshot = await cp.snapshot(); // re-discover only if another round runs
  }
  return { rounds, snapshot, facts };
}

// The judge's evidence. Two rules the naive flatten got wrong, both of which HID the bug from the judge:
//   • a read whose value is `null`/`undefined` must show as null/undefined, NOT the string 'ok' — a label
//     that lies (shows nothing) is exactly the semantic bug the judge is asked to catch (`'value' in r`,
//     not `??`, so a genuine null read survives).
//   • structural signals the judge is told to reason about (`drove:'nothing'`, `wired:false`, engine-
//     swallowed `errors`, an `unreachable` press) must be surfaced, not stripped down to 'ok'.
export const compactSteps = (raw) => raw.map((s) => {
  const r = s.result || {};
  const o = { op: s.step.op, target: s.step.ref || s.step.sel };
  o.result = ('value' in r) ? (r.value === undefined ? '(undefined)' : r.value) : (r.ok === false ? r : 'ok');
  if (r.drove !== undefined) o.drove = r.drove;                                  // 'nothing' / ['touch'] — the fired:0 misread
  if (r.wired === false) o.wired = false;                                        // a press into a button with no handler
  if (r.unreachable) o.unreachable = r.unreachable;                             // a covered / off-screen button
  if (r.errors && r.errors.length) o.errors = r.errors.map((e) => e.text || String(e)); // engine-swallowed throws
  return o;
});

// A copse USAGE error (the agent wrote a malformed selector/op) proves nothing about the game — it's the
// agent flubbing the test, i.e. inconclusive, NOT a defect. A real pageerror/throw IS a defect.
// CRITICAL: match ONLY copse's own grammar-rejection vocabulary, never generic JS error text. `cannot read`
// / `is not a function` / `no such` are the MOST COMMON real game crashes; matching them here silently
// downgraded genuine null-derefs to "inconclusive" — a missed bug, the one thing this tool must never do.
// Exported so impact.mjs shares the single definition instead of a drifting copy.
export const USAGE_ERR = /selector needs|no[- ]?component|bad[- ]?selector|unresolved|unknown[- ]?op|unsupported[- ]?op|:Comp\.member/i;

export function agentFor(scenario, surface) {
  return {
    plan: async ({ context, snapshot }) => {
      const refs = (snapshot || []).filter((n) => n.button).map((n) => n.ref);
      return llm(`${surface}\n\nButtons visible right now: ${refs.join(', ') || '(none — press to reveal)'}\n\nGoal: ${context.goal}\n\nWrite a short test. Output ONLY JSON:\n{"rationale":"...","steps":[ ...press/get/sleep steps... ],"expect":"a plain-English statement of the correct outcome (the oracle)"}\nUse op:press, op:get, and a {"op":"sleep","ms":700} after EVERY press.`, 1800);
    },
    // classify the run — "inconclusive" (the plan never set up its precondition) is NOT a detection.
    judge: async ({ plan, steps }) => {
      const j = await llm(`${surface}\n\nIntent: ${plan.rationale}\nOracle (expected): ${plan.expect}\n\nObserved step results:\n${JSON.stringify(compactSteps(steps), null, 1)}\n\nClassify this run:\n- "bug": a real defect is proven — a SHOWN label disagrees with the REAL state; a value that should have reset didn't; OR a control the player is meant to use is broken (a press returned ok:false / 'disabled', or a button did nothing / was unreachable when it should have worked).\n- "inconclusive": ONLY when YOUR OWN plan never set up the scenario (e.g. you never drove the hero to hp 0, so a reset was never triggered). A control that is disabled or dead is NOT inconclusive — that IS the bug.\n- "ok": the behaviour is correct.\nOutput ONLY JSON: {"verdict":"bug"|"inconclusive"|"ok","reason":"..."}`, 800);
      return { verdict: j.verdict, reason: j.reason, pass: j.verdict === 'ok' };
    },
  };
}

// THE VERDICT — pure over a runLoop result + the scenario. This is arbor's whole reason to exist (copse
// only reports facts; arbor decides what they mean), so it's extracted from runAgent to be testable
// WITHOUT a browser or an LLM: feed a synthetic `{rounds, facts}` and assert detected/by/reason.
//   detected  = the judge said 'bug'  OR  a real (non-usage) error fact  OR  a structural fact
//               (undriven/unreachable) — the last is UNCONDITIONAL (a dead button is a defect always).
//   usageErrs = copse rejected the agent's own malformed step (USAGE_ERR) → inconclusive, not a defect.
export function classify(out, scenario) {
  const raw = out.rounds.flatMap((r) => r.steps || []);
  const gameErrs = (out.facts.errored || []).filter((e) => !USAGE_ERR.test(e.error || ''));
  const usageErrs = (out.facts.errored || []).filter((e) => USAGE_ERR.test(e.error || ''));
  const errReasons = gameErrs.map((e) => `${e.ref}: ${e.error}`);
  const structReasons = [
    ...(out.facts.undriven || []).map((u) => `${u.ref}: dead button (drove nothing)`),
    ...(out.facts.unreachable || []).map((u) => `${u.ref}: unreachable (blocked by ${u.blockedBy})`),
  ];
  const bugReasons = out.rounds.filter((r) => r.verdict && r.verdict.verdict === 'bug').map((r) => r.verdict.reason);
  const judgeInconclusive = out.rounds.some((r) => r.verdict && r.verdict.verdict === 'inconclusive');
  const inconclusive = judgeInconclusive || usageErrs.length > 0;
  const structCounts = structReasons.length > 0; // UNCONDITIONAL — a dead/unreachable button is a defect in ANY scenario kind (copse's driveGate/reachableGate never gated on kind:'gate')
  const detected = bugReasons.length > 0 || errReasons.length > 0 || structCounts;
  const by = bugReasons.length ? 'judge' : (errReasons.length || structCounts) ? 'gate' : inconclusive ? 'inconclusive' : '—';
  // SOFT signals copse gathered (and pays screenshots for): a press it couldn't confirm reachable, or a
  // node the logic diff showed but that didn't render. Never a hard `detected` (fail-loud, not fail), but
  // "fail-loud uncertainty reaches the report instead of a silent pass" — so they surface in `reason` and
  // as fields, rather than being dropped on the floor (which discarded them AND wasted copse's screenshots).
  const uncertain = out.facts.uncertain || [];
  const visual = out.facts.visual || [];
  const softReasons = [
    ...uncertain.map((u) => `${u.ref}: ${u.why} (verify)`),
    ...visual.map((v) => `${v.node}: shown but not drawn (${v.reason})`),
  ];
  const reason = [...bugReasons, ...errReasons, ...(structCounts ? structReasons : [])].join('; ')
    || (inconclusive ? 'inconclusive: ' + [...usageErrs.map((e) => `agent op error: ${e.error}`), ...out.rounds.map((r) => r.verdict && r.verdict.reason).filter(Boolean)].join('; ')
      : softReasons.length ? 'verify: ' + softReasons.join('; ')
        : 'no issue found');
  const rationale = out.rounds.map((r) => r.rationale).filter(Boolean).join(' | ');
  return { id: scenario.id, bug: scenario.bug, kind: scenario.kind, pins: scenario.pins, detected, by, reason, rationale, uncertain, visual, raw };
}

// one scenario run → a normalized finding. Drives copse's `execute` via arbor's own runLoop, then classifies.
export async function runAgent(cp, scenario, execute, surface) {
  let out;
  try { out = await runLoop(cp, execute, agentFor(scenario, surface), { context: { goal: scenario.goal } }); }
  catch (e) { return { id: scenario.id, bug: scenario.bug, kind: scenario.kind, pins: scenario.pins, detected: false, by: 'error', reason: `harness/LLM error: ${e.message}`, raw: [] }; }
  return classify(out, scenario);
}

// F5 — serialize a finding into a deterministic `copse run` tripwire (or null if not freezable)
export function toScript(finding) {
  const gets = (finding.raw || []).filter((s) => s.step.op === 'get' && s.result && 'value' in s.result);
  if (!gets.length) return null; // a gate finding has no state to assert green — coverage gate guards it
  const pins = (finding.pins || []).map((p) => ({ op: 'patch', sel: p.sel, hooks: { replace: p.replace } }));
  const body = (finding.raw || []).map((s) => {
    const step = { ...s.step };
    if (step.op === 'get' && s.result && 'value' in s.result) step.expect = { value: s.result.value };
    return step;
  });
  return { name: `candidate-${finding.id}`, note: `AUTO-FROZEN from an arbor finding (bug ${finding.bug}): ${finding.reason}. Green = bug still present; flips RED when fixed.`, steps: [...pins, ...body] };
}

// F7 — aggregate N runs per scenario into stable / flaky
export function aggregate(runs) {
  const byId = new Map();
  for (const r of runs) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const scenarios = [...byId.values()].map((rs) => {
    // STRICT majority (> half), not ceil(N/2): for even N, ceil(N/2)===N/2 would certify a 50% detector
    // as `stable` (never flaky) and then FREEZE it into a tripwire that flakes in CI forever. floor(N/2)+1
    // equals ceil(N/2) for odd N, so odd-run behaviour is unchanged.
    const N = rs.length, detections = rs.filter((r) => r.detected).length, need = Math.floor(N / 2) + 1;
    return {
      id: rs[0].id, bug: rs[0].bug, kind: rs[0].kind, runs: N, detections, rate: detections / N,
      stable: detections >= need, flaky: detections > 0 && detections < need,
      reasons: [...new Set(rs.filter((r) => r.detected).map((r) => r.reason))],
      by: [...new Set(rs.filter((r) => r.detected).map((r) => r.by))],
    };
  });
  const stableCount = scenarios.filter((s) => s.stable).length;
  return { scenarios, stableCount, flakyCount: scenarios.filter((s) => s.flaky).length, detectionRate: scenarios.length ? stableCount / scenarios.length : 0 };
}
