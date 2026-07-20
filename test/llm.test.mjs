// extractJson — the reply parser for BOTH LLM paths (API assistant-prefill + `claude -p` prose/fences).
// A code review found it doubled the prefilled brace whenever the model fenced or echoed a full object,
// and grabbed the FIRST fence even when it wasn't the JSON — both turning a good reply into a lost run
// (the scenario reported detected:false, by:'error'). These pin the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../src/llm.mjs';

test('extractJson: a genuine continuation from the prefilled "{" (the normal API path)', () => {
  assert.deepEqual(extractJson('"verdict":"bug","reason":"x"}', '{'), { verdict: 'bug', reason: 'x' });
});

test('#6 extractJson: the model ECHOES a whole object despite the prefill → no doubled brace', () => {
  assert.deepEqual(extractJson('{"verdict":"ok"}', '{'), { verdict: 'ok' }); // was '{' + '{…}' = '{{…}' → threw
});

test('#6 extractJson: a fenced object despite the prefill parses (was "unbalanced JSON object")', () => {
  assert.deepEqual(extractJson('```json\n{"verdict":"bug"}\n```', '{'), { verdict: 'bug' });
});

test('#6 extractJson: skips an illustrative non-JSON fence and finds the real one', () => {
  const reply = 'For example ```js\nfoo()\n```\nHere is the verdict:\n```json\n{"v":1}\n```';
  assert.deepEqual(extractJson(reply), { v: 1 });
});

test('extractJson: prose around a bare object (the CLI path)', () => {
  assert.deepEqual(extractJson('The result is {"verdict":"ok"} done.'), { verdict: 'ok' });
});

test('extractJson: nested objects balance; a string brace does not fool the scan', () => {
  assert.deepEqual(extractJson('{"a":{"b":1},"note":"has a } brace"}'), { a: { b: 1 }, note: 'has a } brace' });
});

test('extractJson: no object at all → throws (not a silent empty)', () => {
  assert.throws(() => extractJson('no json here', ''), /no JSON object/);
});
