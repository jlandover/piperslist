// Cloudflare Pages Function — POST /api/search
// Smart natural-language search over PipersList helpers, powered by Claude Haiku 4.5.
//
// The browser sends: { query: string, helpers: [{id, first_name, age, services, other_service, rate}, ...] }
// We send those to Anthropic with the API key from the ANTHROPIC_API_KEY env var
// (set in Cloudflare Pages → Settings → Environment variables — never in client code).
// Claude returns ranked helper IDs + a one-line explanation; the browser reorders cards.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Server is missing ANTHROPIC_API_KEY env var.' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const query = (payload?.query || '').toString().trim();
  const helpers = Array.isArray(payload?.helpers) ? payload.helpers : [];

  if (!query) return json({ error: 'Missing "query".' }, 400);
  if (!helpers.length) return json({ matches: [], explanation: 'No helpers to search yet.' });

  // Cap to keep prompts small and fast
  const capped = helpers.slice(0, 80);

  const helpersText = capped
    .map((h, i) => {
      const services = Array.isArray(h.services) ? h.services.join(', ') : '';
      const other = h.other_service ? ` + ${h.other_service}` : '';
      return `${i + 1}. id=${h.id} | ${h.first_name}, age ${h.age} | services: ${services}${other} | rate: ${h.rate}`;
    })
    .join('\n');

  const system = [
    'You help neighbors find the right local kid for a job on PipersList.',
    'You receive a free-text search query and a numbered list of helpers.',
    'Rank the helpers by how well they fit the query. Only include helpers who could plausibly help.',
    'Match liberally on the spirit of the request: a query about "lawn" matches "Yard help"; "watch my kid" matches "Babysitting"; "homework help" matches "Tutoring"; etc.',
    'Respond with ONLY a JSON object — no prose, no markdown fences, no commentary.',
    'Schema: {"matches": ["<helper_id>", ...], "explanation": "<one short sentence>"}',
    'matches must be helper id strings, ordered best fit first. If nothing fits, return an empty array and a friendly explanation.'
  ].join(' ');

  const user = `Search query: ${query}\n\nHelpers:\n${helpersText}`;

  let apiResp;
  try {
    apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
  } catch (e) {
    return json({ error: 'Failed to reach Anthropic API.', detail: String(e) }, 502);
  }

  if (!apiResp.ok) {
    const detail = await safeText(apiResp);
    return json({ error: `Anthropic API error (${apiResp.status})`, detail }, 502);
  }

  const data = await apiResp.json();
  const text = data?.content?.[0]?.text || '';

  // Extract the JSON object from Claude's reply (defensive — strip any stray prose)
  const result = parseLooseJson(text) || { matches: [], explanation: 'No matches found.' };
  if (!Array.isArray(result.matches)) result.matches = [];
  if (typeof result.explanation !== 'string') result.explanation = '';

  // Only keep IDs that were actually in the input list (defense against hallucinated IDs)
  const validIds = new Set(capped.map((h) => h.id));
  result.matches = result.matches.filter((id) => validIds.has(id));

  return json(result);
}

// Reject any non-POST so a curious crawler doesn't hit Anthropic
export async function onRequest(context) {
  return json({ error: 'POST only.' }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function safeText(resp) {
  try { return await resp.text(); } catch { return ''; }
}

function parseLooseJson(text) {
  if (!text) return null;
  // First try the whole string
  try { return JSON.parse(text); } catch (_) {}
  // Fall back: pull out the first {...} block
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}
