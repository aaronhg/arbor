// arbor · impact (F1 → F4) — a DIFF drives the exploration. coir impact reads the diff into a risk set
// (which buttons/handlers a code change touched); that set becomes the agent's scope. Empty risk → skip.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { openDriver, coirCli } from '../driver.mjs';
import { runLoop, USAGE_ERR } from '../harness.mjs';   // share the ONE definition (was a diverged local copy)
import { llm, USAGE, MODEL } from '../llm.mjs';
import { resolvePath, readSpec } from '../config.mjs';

export async function impact(config, opts = {}) {
  const args = [coirCli(config), '-C', config._dir, 'impact'];
  let input;
  if (opts.patch) { args.push('--patch', '-'); input = opts.patch === '-' ? readFileSync(0, 'utf8') : readFileSync(resolvePath(config, opts.patch), 'utf8'); }
  else if (opts.path) { args.push(opts.path); if (opts.methods) args.push('--methods', opts.methods); }
  else throw new Error('impact: need --patch <diff> or --path <script> [--methods a,b]');
  args.push('-o', 'json');
  const risk = JSON.parse(execFileSync('node', args, { encoding: 'utf8', ...(input ? { input } : {}) }));
  const buttons = (risk.impactedButtons || []).map((b) => ({ ref: b.nodePath.split('/').slice(1).join('/'), method: b.method }));
  const nS = (risk.impactedScenes || []).length;
  console.log(`impact — ${risk.changed.length} changed · ${nS} scene · ${buttons.length} button(s): ${buttons.map((b) => b.ref + '::' + b.method).join(', ') || '(none)'}`);
  if (!buttons.length) return { mode: 'impact', skipped: true, summary: nS ? 'scene/prefab changed but no specific button wired' : 'skip — the change touches no UI surface', findings: [], failed: false };

  const spec = config.spec ? readSpec(config) : null;
  const goal = `A code change affected these buttons (from coir impact): ${buttons.map((b) => b.ref + ' (handler ' + b.method + ')').join(', ')}. Drive EACH affected button and verify it still works: press it (open the settings panel with Canvas/MenuBtn first if it lives inside), read the resulting state, and flag any that is BROKEN — does nothing, is disabled/unreachable, or produces wrong/inconsistent state.`;
  const agent = {
    plan: async ({ snapshot }) => {
      const refs = (snapshot || []).filter((n) => n.button).map((n) => n.ref);
      return llm(`${config.surface}\n\nButtons visible now: ${refs.join(', ')}\n\n${goal}\nOutput ONLY JSON: {"rationale":"...","steps":[ press/get/sleep steps ]}`, 1800);
    },
    judge: async ({ steps }) => {
      const obs = steps.map((s) => ({ op: s.step.op, target: s.step.ref || s.step.sel, result: s.result?.value ?? (s.result?.ok === false ? s.result : 'ok') }));
      const oracle = spec ? `\nDESIGN SPEC (the oracle — flag any impacted button whose behaviour contradicts it):\n${spec}\n` : '';
      const j = await llm(`${config.surface}${oracle}\nThe change affected: ${buttons.map((b) => b.ref).join(', ')}. Observed:\n${JSON.stringify(obs, null, 1)}\n\nList every affected button that is broken (dead / disabled / wrong state${spec ? ' / contradicts the spec' : ''}). Output ONLY JSON: {"findings":[{"ref":"...","symptom":"...","confidence":"high"|"med"|"low"}]}`, 1000);
      return { pass: !(j.findings || []).length, findings: j.findings || [] };
    },
  };
  const { cp, execute } = await openDriver(config, { headed: opts.headed });
  let out; try { await cp.reload(); out = await runLoop(cp, execute, agent, { context: { goal } }); } finally { await cp.close(); }
  const findings = out.rounds.flatMap((r) => (r.verdict && r.verdict.findings) || []);
  const all = [...findings, ...factsGate(out.facts)];
  return { mode: 'impact', url: config.url, model: MODEL, usage: { ...USAGE }, impacted: buttons, findings: all, summary: all.length ? `${all.length} issue(s) in the impacted flows` : 'impacted buttons all behaved', failed: all.length > 0 };
}

// The deterministic half of `impact`: the structural facts (dead / unreachable / genuinely-errored buttons)
// as gate findings. Pure + exported so the "read out.facts, not out" contract is pinned by a test — reading
// `out.undriven` (facts live under `out.facts`) had silently made this whole gate dead code.
export function factsGate(facts) {
  const f = facts || {};
  return [
    ...(f.undriven || []).map((u) => ({ ref: u.ref, symptom: 'dead button (drove nothing)', confidence: 'high' })),
    ...(f.unreachable || []).map((u) => ({ ref: u.ref, symptom: `unreachable (blocked by ${u.blockedBy})`, confidence: 'high' })),
    ...(f.errored || []).filter((e) => !USAGE_ERR.test(e.error || '')).map((e) => ({ ref: e.ref, symptom: e.error, confidence: 'high' })),
  ];
}
