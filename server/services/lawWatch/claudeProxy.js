// Client for RIT's Claude proxy (OpenAI-compatible chat completions; each call
// runs as its own agent session with web search). Uses node:https directly:
// global fetch gives up after 300 s, and a law check can take several minutes.
const https = require('https');

const BASE_URL = process.env.CLAUDE_PROXY_URL || 'https://claudecode.rit.services';
const CALL_TIMEOUT_MS = 20 * 60 * 1000; // the proxy's own per-request limit
const RETRYABLE = new Set([429, 502, 503]);

function post(path, body, token) {
  const url = new URL(path, BASE_URL);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: CALL_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Claude proxy call timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// The proxy ignores response_format, and the model sometimes wraps its answer
// in a code fence or adds a sentence around it: take the outermost {...}.
function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in the answer');
  return JSON.parse(s.slice(start, end + 1));
}

// Ask once, retrying on a full proxy (429) or transient failures. Returns
// { json, costUsd }.
async function askJson({ system, user, model, effort, token, attempts = 4 }) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await post('/v1/chat/completions', {
        model,
        reasoning_effort: effort,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }, token);
      if (RETRYABLE.has(res.status)) throw Object.assign(new Error(`proxy HTTP ${res.status}`), { retry: true });
      if (res.status !== 200) throw new Error(`proxy HTTP ${res.status}: ${res.text.slice(0, 200)}`);
      const body = JSON.parse(res.text);
      const content = body.choices?.[0]?.message?.content || '';
      if (/\[error:[^\]]*\]\s*$/.test(content)) throw Object.assign(new Error('proxy reported an error'), { retry: true });
      return { json: extractJson(content), costUsd: Number(body.usage?.cost_usd) || 0 };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(15000 * (i + 1));
    }
  }
  throw lastErr;
}

module.exports = { askJson, extractJson };
