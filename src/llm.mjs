// canvas-qa · the ONE LLM seam — fixture-agnostic. Anthropic API if a key is present, else the local
// `claude -p`, else nothing (the caller skips Layer 2). Same code path in dev and CI; only the seam
// differs. The API path pins the reply to JSON with a system line + an assistant PREFILL of "{" (the
// model continues from INSIDE the object, so there's no prose to strip); the CLI path leans on
// extractJson, a balanced-brace scan that tolerates ``` fences / surrounding prose.
import { execFileSync } from 'node:child_process';

export function extractJson(text, prefill = '') {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/); // a fenced block wins if present
  const src = prefill + (fence ? fence[1] : text);
  const start = src.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(src.slice(start, i + 1)); // the FIRST balanced object
  }
  throw new Error('unbalanced JSON object in reply');
}

// ONE model knob for both paths. Default Haiku (cheap/fast); override with ANTHROPIC_MODEL
// (e.g. claude-sonnet-5 for sharper semantic judging). The API needs the full id; `claude -p` takes it via --model.
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
export const USAGE = { input: 0, output: 0, cost_usd: 0 }; // accumulated: tokens (API path) + $ (CLI path reports total_cost_usd)

async function llmApi(prompt, maxTokens) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system: 'You are a precise test author and judge. Reply with ONE JSON object and nothing else.',
    messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: '{' }], // prefill → forces JSON
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    USAGE.input += data.usage?.input_tokens || 0; USAGE.output += data.usage?.output_tokens || 0;
    return extractJson(data.content[0].text, '{'); // re-attach the prefilled brace
  }
}

const llmCli = (prompt) => { const j = JSON.parse(execFileSync('claude', ['-p', prompt, '--model', MODEL, '--output-format', 'json'], { encoding: 'utf8', maxBuffer: 64 << 20 }).toString()); if (j.total_cost_usd) USAGE.cost_usd += j.total_cost_usd; return extractJson(j.result); };

let CLI_OK; // memoized `claude` availability
export function hasLLM() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (CLI_OK === undefined) { try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); CLI_OK = true; } catch { CLI_OK = false; } }
  return CLI_OK;
}

export const llm = async (prompt, maxTokens = 1500) => process.env.ANTHROPIC_API_KEY ? llmApi(prompt, maxTokens) : llmCli(prompt);
