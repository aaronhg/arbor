// arbor · console reporter — the human summary (the live run-by-run progress is streamed by the mode).
export function report(result) {
  const r = result;
  if (['coverage', 'visual', 'gate'].includes(r.mode)) { // the gate modes stream their own detail; just the verdict
    console.log(`\n  ${r.failed ? '❌' : '✅'} ${r.summary}`);
    return;
  }
  if (r.mode === 'calibrate') {
    console.log(`\n── detection over ${r.runs} run(s) ─────────────────────────────`);
    for (const s of r.scenarios) {
      const tag = s.stable ? '✅ stable' : s.flaky ? '🟡 flaky ' : '❌ missed';
      console.log(`  ${tag}  bug ${s.bug}  ${String(s.id).padEnd(20)} ${s.detections}/${s.runs}  (${s.by.join('/') || '—'})`);
      if (s.reasons && s.reasons.length) console.log(`            ↳ ${s.reasons[0]}`.slice(0, 150));
    }
    console.log(`  detection rate: ${r.stableCount}/${r.scenarios.length} bugs stably found` + (r.flakyCount ? `, ${r.flakyCount} flaky` : ''));
    for (const c of r.candidates || []) console.log(`  ▶ ${c.file || c.id}: ${c.outcome}${c.why ? ' — ' + c.why : ''}`);
  } else if (r.findings) {
    console.log(`\n── ${r.mode} — ${r.findings.length} finding(s) ─────────────────────────────`);
    for (const f of r.findings) console.log(`  🔴 [${f.confidence || '?'}] ${[f.ref, f.symptom, f.claim].filter(Boolean).join(' · ')}`.slice(0, 220));
  } else if (r.violations) {
    console.log(`\n── ${r.mode} — ${r.violations.length} spec violation(s) ─────────────────────────────`);
    for (const v of r.violations) console.log(`  🔴 [${v.confidence || '?'}] ${v.claim}\n        expected: ${v.expected}\n        observed: ${v.observed}`.slice(0, 320));
    if (r.untested && r.untested.length) console.log(`  · untested: ${r.untested.join(' | ')}`.slice(0, 200));
  }
  if (r.summary) console.log(`\n  ${r.summary}`);
  if (r.score) {
    const s = r.score;
    if (s.error) console.log(`  ⚠️ outcome judge: ${s.error}`);
    else {
      console.log(`\n  ── outcome vs ground truth ──`);
      console.log(`  detected ${s.detection_rate}/${s.total}  ·  missed [${(s.missed || []).join(', ') || '—'}]  ·  false-positives ${s.false_positives}  ·  evidence ${s.evidence_quality}/5`);
      if (s.reasoning) console.log(`  ${s.reasoning}`.slice(0, 220));
    }
  }
  const cost = [];
  if (r.usage && (r.usage.input || r.usage.output)) cost.push(`${r.usage.input.toLocaleString()} in / ${r.usage.output.toLocaleString()} out tok`);
  const usd = r.cost_usd ?? (r.usage && r.usage.cost_usd);
  if (usd) cost.push(`$${usd.toFixed ? usd.toFixed(3) : usd}`);
  if (cost.length) console.log(`  llm cost: ${cost.join(' · ')} (${r.model})`);
}
