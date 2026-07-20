// arbor · contract — what arbor requires of the siblings it drives, asserted at RUNTIME.
//
// arbor resolves copse and coir DYNAMICALLY: a path from `arbor.config.mjs` (`driver.copse` /
// `analyzer.coir`) or an env var, deliberately, so a developer can point it at a working tree. That is the
// whole reason this file exists — npm's version resolution never runs, no lockfile pins anything, and a
// package.json `version` bump is a number nobody on this path ever reads. During 0.x the interfaces move
// without the version moving at all.
//
// So the check has to live where the data actually arrives, and it has to be LOUD. A silent mismatch is
// the worst outcome available here: arbor's job is to decide whether a game passed, so an incompatible
// sibling doesn't crash — it quietly produces a verdict from a shape it half-understands. A gate that
// says "pass" because it could not read the facts is worse than no gate.
//
// Two different guards, because the two payloads differ in what they can carry:
//   • copse — `capabilities.contractVersion`, read off the live session. arbor already reads capabilities
//     to branch on engine facts, so this costs nothing extra.
//   • coir  — `impact -o json` carries `schema`. `clickmap -o json` is array-shaped and can carry no
//     top-level field, so it is guarded by SHAPE instead (and by the golden fixtures in test/contract/).

/** copse contract versions arbor can drive. Add the new one here when copse bumps and arbor adapts. */
export const COPSE_SUPPORTED = [1];
/** coir `impact` schema versions arbor can read. */
export const COIR_IMPACT_SUPPORTED = [1];

const fail = (msg) => { throw Object.assign(new Error(msg), { arbor: true, code: 'contract-mismatch' }); };

const how = (name, path) =>
  `\n  arbor resolves ${name} from your config (${path}) or env — check that path points at the version you think it does.`;

/**
 * Assert a live copse session speaks a contract arbor understands.
 * An ABSENT version is treated as too old, not as "probably fine": every copse that carries the field
 * announces it, so a missing one means a build from before the contract existed.
 * @param {any} caps  the session's `capabilities` object
 * @param {string} [path]  where copse was resolved from, for the error message
 */
export function assertCopse(caps, path = 'driver.copse') {
  const v = caps && caps.contractVersion;
  if (v == null) {
    fail(`copse is too old for this arbor: its capabilities carry no contractVersion, so it predates the `
      + `contract (arbor needs ${COPSE_SUPPORTED.join(' or ')}).${how('copse', path)}`);
  }
  if (!COPSE_SUPPORTED.includes(v)) {
    fail(`copse speaks contract v${v}, arbor drives ${COPSE_SUPPORTED.join(' or ')}. `
      + `${v > Math.max(...COPSE_SUPPORTED) ? 'copse is NEWER than this arbor — upgrade arbor.' : 'copse is older — upgrade copse.'}`
      + how('copse', path));
  }
  return caps;
}

/**
 * Assert a coir `impact -o json` payload is a schema arbor can read, and hand it back.
 * @param {any} risk  the parsed impact object
 * @param {string} [path]
 */
export function assertCoirImpact(risk, path = 'analyzer.coir') {
  const v = risk && risk.schema;
  if (v == null) {
    fail(`coir is too old for this arbor: its \`impact -o json\` carries no \`schema\` field `
      + `(arbor needs ${COIR_IMPACT_SUPPORTED.join(' or ')}).${how('coir', path)}`);
  }
  if (!COIR_IMPACT_SUPPORTED.includes(v)) {
    fail(`coir's impact schema is v${v}, arbor reads ${COIR_IMPACT_SUPPORTED.join(' or ')}.`
      + how('coir', path));
  }
  return risk;
}

/**
 * `clickmap -o json` has no version to check, so verify the SHAPE arbor actually binds to. Empty is
 * legal (a scene with no wired buttons); a non-array, or rows missing `nodePath`, is not — that is the
 * drift this cannot otherwise see, and it would otherwise surface as a coverage gate that silently
 * matches nothing and reports full coverage.
 * @param {any} rows  the parsed clickmap array
 * @param {string} [path]
 */
export function assertCoirClickmap(rows, path = 'analyzer.coir') {
  if (!Array.isArray(rows)) {
    fail(`coir's \`clickmap -o json\` returned ${rows === null ? 'null' : typeof rows}, not an array — `
      + `its output shape changed.${how('coir', path)}`);
  }
  const bad = rows.find((r) => !r || typeof r.nodePath !== 'string');
  if (bad) {
    fail(`coir's \`clickmap -o json\` rows no longer carry a string \`nodePath\` (got ${JSON.stringify(bad).slice(0, 80)}) — `
      + `the join key arbor matches on is gone.${how('coir', path)}`);
  }
  return rows;
}
