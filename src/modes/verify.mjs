// arbor · verify — spec-grounded, single agent. Given the design spec as the oracle, drive the game and
// report where reality VIOLATES the spec. `--min` uses config.specMin (the blind-spot probe).
import { openDriver } from '../driver.mjs';
import { runLoop } from '../harness.mjs';
import { llm, USAGE, MODEL } from '../llm.mjs';
import { readSpec } from '../config.mjs';

export async function verify(config, opts = {}) {
  const spec = readSpec(config, opts.min ? 'specMin' : 'spec');
  if (!spec) throw new Error(`verify: config.${opts.min ? 'specMin' : 'spec'} is not set`);
  const runs = Number(opts.runs || 3);
  const surface = config.surface;
  const agent = {
    plan: async ({ snapshot }) => {
      const refs = (snapshot || []).filter((n) => n.button).map((n) => n.ref);
      return llm(`DESIGN SPEC (the intended behaviour — your oracle):\n${spec}\n\n${surface}\n\nButtons visible now: ${refs.join(', ')}\n\nWrite ONE test run that verifies the spec's claims against the real game — cover the controls, the HUD labels, and the run lifecycle. CRITICALLY set up the precondition each claim needs before checking it (e.g. to check a reset, first drive the hero to death, then restart, then read; to check a label after a state change, actually cause the change). Output ONLY JSON: {"rationale":"...","steps":[ 20-30 press/get/sleep steps ]}`, 2200);
    },
    judge: async ({ steps }) => {
      const obs = steps.map((s) => ({ op: s.step.op, target: s.step.ref || s.step.sel, result: s.result?.value ?? (s.result?.ok === false ? s.result : 'ok') }));
      const j = await llm(`DESIGN SPEC (the oracle):\n${spec}\n\n${surface}\n\nYou ran a test against the spec. Observed:\n${JSON.stringify(obs, null, 1)}\n\nList every place the GAME VIOLATES THE SPEC. Rules: only report a violation a spec claim actually forbids; only a claim you ACTUALLY reached (an unmet precondition = untested, not a violation); nothing the spec doesn't cover. Output ONLY JSON: {"violations":[{"claim":"...","expected":"...","observed":"...","confidence":"high"|"med"|"low"}],"untested":["..."]}`, 1600);
      return { pass: !(j.violations || []).length, violations: j.violations || [], untested: j.untested || [] };
    },
  };
  const { cp, execute } = await openDriver(config, { headed: opts.headed });
  const violations = [], untested = [];
  try {
    for (let n = 0; n < runs; n++) {
      await cp.reload();
      let v = [], u = [];
      try { const out = await runLoop(cp, execute, agent, { context: { goal: 'verify the build against the spec' } }); v = out.rounds.flatMap((r) => (r.verdict && r.verdict.violations) || []); u = out.rounds.flatMap((r) => (r.verdict && r.verdict.untested) || []); }
      catch (e) { console.log(`  run ${n + 1}/${runs}  ⚠️ ${e.message}`); continue; }
      console.log(`  run ${n + 1}/${runs} — ${v.length} violation(s)${u.length ? `, ${u.length} untested` : ''}`);
      violations.push(...v); untested.push(...u);
    }
  } finally { await cp.close(); }
  return { mode: 'verify', url: config.url, model: MODEL, usage: { ...USAGE }, runs, violations, untested: [...new Set(untested)], summary: `${violations.length} raw spec violation(s) across ${runs} run(s)`, failed: false };
}
