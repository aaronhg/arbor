// arbor · eval — the OUTCOME judge (gstack's shape): score a mode's findings against a committed
// ground-truth bug list → detected / missed / false_positives / detection_rate / evidence_quality.
// Formalises "did it find the known bugs" into one number instead of hand-bucketing. Only runs when
// config.groundTruth is set (i.e. you have an answer key — a fixture / calibration target).
import { readFileSync } from 'node:fs';
import { llm } from './llm.mjs';
import { resolvePath } from './config.mjs';

export async function outcomeJudge(config, findingsOrReport) {
  const gt = JSON.parse(readFileSync(resolvePath(config, config.groundTruth), 'utf8'));
  const report = typeof findingsOrReport === 'string' ? findingsOrReport : JSON.stringify(findingsOrReport, null, 1);
  const ids = gt.bugs.map((b) => b.id).join(', ');
  const j = await llm(`You are evaluating a QA report against known ground-truth bugs.

GROUND TRUTH (${gt.total_bugs} planted bugs):
${JSON.stringify(gt.bugs, null, 2)}

QA REPORT (produced by an AI agent):
${report}

For each planted bug, decide if the report identified it — it counts as "detected" if the report
describes the SAME defect, even if the wording differs (use each bug's detection_hint keywords as
guidance). Count false_positives: report issues that match no planted bug AND aren't a legitimate
defect of the game.

Output ONLY JSON:
{"detected":[<bug ids>],"missed":[<bug ids>],"false_positives":N,"detection_rate":N,"evidence_quality":N,"reasoning":"..."}
Rules:
- detected / missed contain ONLY ids from: ${ids}
- detection_rate = length of the detected array
- evidence_quality (1-5): do the detected bugs cite concrete evidence (state values, refs, repro)? 5 = strong evidence for each, 1 = none.`, 1300);

  const detected = j.detected || [];
  return {
    detected, missed: j.missed || gt.bugs.map((b) => b.id).filter((id) => !detected.includes(id)),
    false_positives: j.false_positives || 0,
    detection_rate: j.detection_rate ?? detected.length,
    evidence_quality: j.evidence_quality,
    reasoning: j.reasoning || '',
    total: gt.total_bugs,
  };
}
