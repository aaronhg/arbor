// arbor · explore (F8, experimental) — the DIVERGENT probe. No goal, no pins, no oracle: the agent
// freely explores and reports anything it judges wrong. Finds surface bugs; noisy on the rest (no
// oracle → judgment noise). Output is DATA about that gap, not a gate.
import { openDriver } from '../driver.mjs';
import { runLoop } from '../harness.mjs';
import { llm, USAGE, MODEL } from '../llm.mjs';

export async function explore(config, opts = {}) {
  const runs = Number(opts.runs || 3);
  const surface = config.surface;
  const agent = {
    plan: async ({ snapshot }) => {
      const refs = (snapshot || []).filter((n) => n.button).map((n) => n.ref);
      return llm(`${surface}\n\nButtons visible now: ${refs.join(', ')}\n\nExplore the game BROADLY to hunt for defects — try each control, fight several turns, read both the labels and the underlying state, open and close menus, and if the hero dies, restart and look. You are NOT told what is correct — decide for yourself. Output ONLY JSON: {"rationale":"...","steps":[ 15-25 press/get/sleep steps ]}`, 2000);
    },
    judge: async ({ steps }) => {
      const obs = steps.map((s) => ({ op: s.step.op, target: s.step.ref || s.step.sel, result: s.result?.value ?? (s.result?.ok === false ? s.result : 'ok') }));
      const j = await llm(`${surface}\n\nYou explored the game. Observed:\n${JSON.stringify(obs, null, 1)}\n\nFrom FIRST PRINCIPLES (no spec given), list EVERY behaviour that looks like a defect — a control that does nothing, a shown label disagreeing with real state, a value that should have reset but didn't, anything inconsistent. Be honest about uncertainty; an empty list is fine. Output ONLY JSON: {"findings":[{"symptom":"...","evidence":"...","confidence":"high"|"med"|"low"}]}`, 1500);
      return { pass: !(j.findings || []).length, findings: j.findings || [] };
    },
  };
  const { cp, execute } = await openDriver(config, { headed: opts.headed });
  const findings = [];
  try {
    for (let n = 0; n < runs; n++) {
      await cp.reload();
      let f = [];
      try { const out = await runLoop(cp, execute, agent, { context: { goal: 'free exploration' } }); f = out.rounds.flatMap((r) => (r.verdict && r.verdict.findings) || []); }
      catch (e) { console.log(`  run ${n + 1}/${runs}  ⚠️ ${e.message}`); continue; }
      console.log(`  run ${n + 1}/${runs} — ${f.length} suspected defect(s)`);
      findings.push(...f);
    }
  } finally { await cp.close(); }
  return { mode: 'explore', url: config.url, model: MODEL, usage: { ...USAGE }, runs, findings, summary: `${findings.length} raw suspected defect(s) across ${runs} run(s) — bucket by hand (planted / novel / false positive)`, failed: false };
}
