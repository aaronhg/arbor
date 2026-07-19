// arbor · eval store (gstack's EvalCollector) — append each outcome-judged run to config.evalStore, so
// the AI layer's OWN quality is tracked over time: did detection_rate / evidence drop after a model
// swap, a prompt tweak, or a copse upgrade? An append-only JSONL; each record notes the delta vs the
// previous same-mode entry, so a regression shows the moment it happens.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolvePath } from './config.mjs';

export function recordEval(config, result) {
  const store = resolvePath(config, config.evalStore);
  const s = result.score;
  if (!store || (s && s.error)) return;
  const common = {
    ts: new Date().toISOString(), mode: result.mode, model: result.model || null,
    cost_usd: (result.cost_usd ?? (result.usage && result.usage.cost_usd)) || null,
    tokens: result.usage ? { input: result.usage.input, output: result.usage.output } : null,
  };
  // outcome-judged (a `score`) OR calibrate (self-scored via detectionRate/scenarios)
  const entry = s
    ? { ...common, detection_rate: s.detection_rate, total: s.total, evidence_quality: s.evidence_quality ?? null, false_positives: s.false_positives, missed: s.missed }
    : { ...common, detection_rate: result.stableCount, total: (result.scenarios || []).length, evidence_quality: null, false_positives: result.flakyCount ?? null, missed: (result.scenarios || []).filter((x) => !x.stable).map((x) => x.id) };
  if (entry.detection_rate == null) return;

  let prev = null;
  if (existsSync(store)) { try { prev = [...readFileSync(store, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))].reverse().find((e) => e.mode === result.mode); } catch { /* a corrupt line — skip the compare */ } }
  mkdirSync(dirname(store), { recursive: true });
  appendFileSync(store, JSON.stringify(entry) + '\n');

  const rel = store.replace(config._dir + '/', '');
  if (prev) {
    const arrow = (n) => n > 0 ? `↑${n}` : n < 0 ? `↓${Math.abs(n)}` : '=';
    console.log(`  eval recorded → ${rel}  (vs last ${result.mode}: detection ${arrow(entry.detection_rate - prev.detection_rate)}, evidence ${arrow((entry.evidence_quality || 0) - (prev.evidence_quality || 0))})`);
  } else console.log(`  eval recorded → ${rel}  (first ${result.mode} entry)`);
}
