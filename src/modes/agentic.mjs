// arbor · agentic (gstack's shape) — hand the whole loop to `claude -p`: the agent AUTONOMOUSLY drives
// the game through the copse MCP tools (connect/snapshot/press/get/patch/…), multi-turn, adapting as it
// goes, and writes a report. This is the road arbor's runHarness modes did NOT take (they constrain the
// LLM to plan+judge; copse drives). The test it answers: can an adaptive multi-turn agent reach the
// deep-state bugs (die→restart) WITHOUT hand-authored pins? Scored by the outcome judge (eval.mjs).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copseCli } from '../driver.mjs';
import { MODEL } from '../llm.mjs';

export async function agentic(config, opts = {}) {
  const budget = Number(opts.budget || 0.6); // hard $ cap on the autonomous run (--max-budget-usd)
  // a stdio MCP server: `copse mcp <url>` — the agent connects and drives the live game through it
  const dir = mkdtempSync(join(tmpdir(), 'arbor-agentic-'));
  const mcpCfg = join(dir, 'mcp.json');
  writeFileSync(mcpCfg, JSON.stringify({ mcpServers: { copse: { command: 'node', args: [copseCli(config), 'mcp', config.url] } } }));

  const prompt = `You are QA-testing a Cocos game by driving it yourself through the "copse" MCP tools (connect, snapshot, interactive, press, get, patch, reachable, orient …). Explore multi-step and reason over the state — you cannot see pixels.

${config.surface}

Game URL: ${config.url}

Do this:
1. Call connect (url: ${config.url}), then snapshot / interactive to see the buttons.
2. Drive the game to hunt for defects — press every control, fight several turns reading BOTH labels and real state, open+close menus, and DELIBERATELY set up deep states (e.g. to check a reset, actually drive the hero to death, then restart, then read the tally). Use patch to pin RNG if you need a state deterministically.
3. Report EVERY behaviour that looks wrong — a control that does nothing, a shown label disagreeing with the real state, a value that should reset but didn't.

IMPORTANT: state each bug in your message THE MOMENT you find it (symptom + the state/ref that proves it) — do not save it all for the end, in case you run low on budget. If you get to the end, also emit a fenced json block: {"findings":[{"symptom":"...","evidence":"...","confidence":"high|med|low"}]}`;

  console.log(`agentic · claude -p (${MODEL}) driving copse MCP · budget $${budget} …`);
  // stream-json keeps the whole transcript even when the run is budget-cut (plain json returns only the
  // final error payload). We score the transcript, not just a final report block.
  // agentic drives the `claude` CLI directly (not the API), so an API-key-only env still can't run it.
  let raw = '';
  try {
    raw = execFileSync('claude', ['-p', prompt, '--mcp-config', mcpCfg, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--max-budget-usd', String(budget)], { encoding: 'utf8', maxBuffer: 256 << 20, timeout: (opts.timeout || 10 * 60) * 1000 }).toString();
  } catch (e) {
    raw = (e.stdout || '').toString();
    if (!raw) { // a real spawn failure (ENOENT / crash), not a budget-cut mid-run — fail loud, don't fake a 0/4
      const why = e.code === 'ENOENT' ? 'the `claude` CLI is not on PATH — arbor agentic drives `claude -p` directly (an ANTHROPIC_API_KEY alone is not enough)' : e.message;
      return { mode: 'agentic', url: config.url, model: MODEL, report: null, findings: null, summary: `agentic could not run: ${why}`, failed: true };
    }
  }

  const texts = []; let usd = null, turns = null, reason = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) for (const c of ev.message.content) if (c.type === 'text' && c.text) texts.push(c.text);
    if (ev.type === 'result') { usd = ev.total_cost_usd ?? usd; turns = ev.num_turns ?? turns; reason = ev.subtype ?? reason; }
  }
  const report = texts.join('\n\n') || '(no assistant output captured)';
  let findings = [];
  try { const m = report.match(/\{[\s\S]*"findings"[\s\S]*\}/); if (m) findings = JSON.parse(m[0]).findings || []; } catch { /* the judge will read the transcript instead */ }

  console.log(`agentic · ${turns ?? '?'} turns · $${usd?.toFixed?.(3) ?? usd} · ${reason || 'done'}`);
  return { mode: 'agentic', url: config.url, model: MODEL, budget, cost_usd: usd, turns, terminated: reason, report, findings, summary: `${findings.length} explicit finding(s) · ${turns ?? '?'} turns · $${usd?.toFixed?.(3) ?? usd} (${reason || 'done'})`, failed: false };
}
