// arbor · orchestrate — the coordinator/worker/judge pipeline, in-process. A coordinator decomposes the
// spec (+ the pinnable RNG map) into scoped tasks each carrying its own pins; sequential workers drive
// one claim each (pins → precondition → oracle); a judge cross-checks the verdicts. This is the recipe
// that reaches the deep-state bugs a single agent can't: spec = oracle+goals, pins = reachability.
import { openDriver, applyPins } from '../driver.mjs';
import { runLoop } from '../harness.mjs';
import { llm, USAGE, MODEL } from '../llm.mjs';
import { readSpec } from '../config.mjs';

export async function orchestrate(config, opts = {}) {
  const spec = readSpec(config);
  if (!spec) throw new Error('orchestrate: config.spec is not set');

  // 1 · coordinator — spec + pinnable → scoped tasks
  const plan = await llm(`You are the QA COORDINATOR. Decompose the design spec into a SMALL set (4-6) of scoped verification TASKS a worker can drive. For each emit {id, claim, pins, goal, oracle}. Use the pinnable RNG (below) to make a claim's state reachable DETERMINISTICALLY (e.g. force a death to test a reset; force a descend to test a floor label). Only tasks for behaviours the spec states.\n\nDESIGN SPEC:\n${spec}\n\nPINNABLE RNG (replace via a pin {sel, replace}):\n${config.pinnable}\n\n${config.surface}\n\nOutput ONLY JSON: {"tasks":[{"id":"...","claim":"...","pins":[{"sel":"...","replace":"..."}],"goal":"...","oracle":"..."}]}`, 2500);
  const tasks = plan.tasks || [];
  console.log(`coordinator → ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ')}`);

  // 2 · workers — one claim each, sequential (shared driver: reload + repin between)
  const { cp, execute } = await openDriver(config, { headed: opts.headed });
  const verdicts = [];
  try {
    for (const t of tasks) {
      await applyPins(cp, t.pins);
      const agent = {
        plan: async ({ snapshot }) => {
          const refs = (snapshot || []).filter((n) => n.button).map((n) => n.ref);
          return llm(`${config.surface}\n\nButtons now: ${refs.join(', ')}\n\nTask: ${t.goal}\nDrive to the precondition, then read exactly what the check needs. Output ONLY JSON: {"rationale":"...","steps":[ press/get/sleep steps ]}`, 1800);
        },
        judge: async ({ steps }) => {
          const obs = steps.map((s) => ({ op: s.step.op, target: s.step.ref || s.step.sel, result: s.result?.value ?? (s.result?.ok === false ? s.result : 'ok') }));
          const j = await llm(`${config.surface}\n\nClaim under test: ${t.claim}\nOracle (the spec requires): ${t.oracle}\n\nObserved:\n${JSON.stringify(obs, null, 1)}\n\nDid the game VIOLATE the oracle? If the precondition was never reached, answer "inconclusive". Output ONLY JSON: {"verdict":"bug"|"ok"|"inconclusive","evidence":"..."}`, 800);
          return { verdict: j.verdict, evidence: j.evidence, pass: j.verdict === 'ok' };
        },
      };
      let v = { verdict: 'error', evidence: '' };
      try { const out = await runLoop(cp, execute, agent, { context: { goal: t.goal } }); const last = out.rounds.map((r) => r.verdict).filter(Boolean).pop() || {}; v = { verdict: last.verdict || 'inconclusive', evidence: last.evidence || '' }; }
      catch (e) { v = { verdict: 'error', evidence: e.message }; }
      console.log(`  ${t.id}: ${v.verdict}`);
      verdicts.push({ id: t.id, claim: t.claim, ...v });
    }
  } finally { await cp.close(); }

  // 3 · judge — cross-check the verdicts into a report
  const report = await llm(`You are the QA JUDGE. Worker verdicts from verifying a game against its spec:\n${JSON.stringify(verdicts, null, 1)}\n\nFor each: is the evidence sound, or a misread / unreached precondition? Produce a final report: which claims are CONFIRMED violations (real defects, cite evidence), which are inconclusive/untested, and a 2-sentence summary. Output ONLY JSON: {"confirmed":[{"claim":"...","evidence":"..."}],"inconclusive":["..."],"summary":"..."}`, 1500);
  return {
    mode: 'orchestrate', url: config.url, model: MODEL, usage: { ...USAGE }, tasks: verdicts,
    findings: (report.confirmed || []).map((c) => ({ claim: c.claim, symptom: c.evidence, confidence: 'high' })),
    inconclusive: report.inconclusive || [],
    summary: report.summary || `${(report.confirmed || []).length} confirmed violation(s)`,
    failed: (report.confirmed || []).length > 0,
  };
}
