// `pa decide`: a small, fast decision step that speaks the "System One" request shape
// used by decision models (a JSON state plus typed questions, answered with a choice
// and a confidence, a score, or free text). Three interchangeable backends:
//
//   heuristic  no model; keyword overlap. Always available; used in tests.
//   systemone  POST to any endpoint that speaks the System One shape, for example a
//              hosted decision model or a locally served open-weights decision model.
//   ollama     a local model through Ollama's /api/chat with a JSON-schema answer.
//
// Request:  { model?, state: "<text or JSON>", questions: { <name>: { type: "choice"|"score"|"noul",
//             instructions: "...", options?: [..], criteria?: "..." } } }
// Response: { answers: { <name>: { type, choice, confidence, probabilities } | { type, score } | { type, noul } }, backend }

function words(s) { return new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || []); }

export function heuristic(req) {
  const state = words(typeof req.state === 'string' ? req.state : JSON.stringify(req.state));
  const answers = {};
  for (const [name, q] of Object.entries(req.questions || {})) {
    if (q.type === 'choice') {
      const opts = q.options || (Array.isArray(q.criteria) ? q.criteria : []);
      const scores = opts.map(o => { let n = 1; for (const w of words(o)) if (state.has(w)) n++; return n; });
      const total = scores.reduce((a, b) => a + b, 0) || 1;
      const probabilities = Object.fromEntries(opts.map((o, i) => [o, Number((scores[i] / total).toFixed(3))]));
      let best = 0; scores.forEach((s, i) => { if (s > scores[best]) best = i; });
      answers[name] = { type: 'choice', choice: opts[best] ?? null, confidence: probabilities[opts[best]] ?? 0, probabilities };
    } else if (q.type === 'score') {
      answers[name] = { type: 'score', score: 0.5 };
    } else {
      answers[name] = { type: 'noul', noul: '' };
    }
  }
  return { answers, backend: 'heuristic' };
}

export async function systemone(req, cfg) {
  if (!cfg.url) throw new Error('decide.url is not set');
  const key = process.env[cfg.api_key_env || 'PA_DECIDE_API_KEY'];
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: req.model || cfg.model || undefined, state: req.state, questions: req.questions }),
  });
  if (!res.ok) throw new Error(`decision endpoint returned ${res.status}`);
  return { ...(await res.json()), backend: 'systemone' };
}

export async function ollama(req, cfg) {
  const base = (cfg.url || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const answers = {};
  for (const [name, q] of Object.entries(req.questions || {})) {
    const opts = q.options || [];
    const schema = q.type === 'choice'
      ? { type: 'object', properties: { choice: { type: 'string', enum: opts }, confidence: { type: 'number' } }, required: ['choice', 'confidence'] }
      : q.type === 'score'
        ? { type: 'object', properties: { score: { type: 'number' } }, required: ['score'] }
        : { type: 'object', properties: { noul: { type: 'string' } }, required: ['noul'] };
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model || cfg.model, stream: false, format: schema, options: { temperature: 0 },
        messages: [
          { role: 'system', content: 'You answer one decision question about the given state. Reply only with the JSON object requested. Confidence is a number from 0 to 1. Scores are from 0 to 1.' },
          { role: 'user', content: `STATE:\n${typeof req.state === 'string' ? req.state : JSON.stringify(req.state)}\n\nQUESTION (${q.type}): ${q.instructions}\n${q.criteria ? `CRITERIA: ${q.criteria}\n` : ''}${opts.length ? `OPTIONS: ${opts.join(' | ')}` : ''}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama returned ${res.status}`);
    const out = JSON.parse((await res.json()).message.content);
    answers[name] = { type: q.type, ...out };
  }
  return { answers, backend: 'ollama' };
}

export async function decide(req, cfg = { backend: 'heuristic' }) {
  if (!req?.questions || typeof req.questions !== 'object') throw new Error('request needs a "questions" object');
  if (cfg.backend === 'systemone') return systemone(req, cfg);
  if (cfg.backend === 'ollama') return ollama(req, cfg);
  return heuristic(req);
}
