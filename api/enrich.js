const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed', contacts: [] }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON', contacts: [] }, 400); }

  const { org, domain, source } = body || {};
  if (!org || !source) return json({ error: 'Missing parameters', contacts: [] }, 400);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set', contacts: [] }, 500);

  const sourceLabel = { apollo: 'Apollo.io', clay: 'Clay', vibe: 'Vibe Prospecting' }[source] || source;

  const prompt = `Find senior decision-makers and contacts at the company "${org}"${domain ? ` (website: ${domain})` : ''}.

Search the web for their LinkedIn profiles, company website team pages, news articles, and directories.

Return a JSON array of up to 8 contacts. Each object must have:
- name (full name)
- title (job title)
- email (if found, otherwise empty string)
- phone (if found, otherwise empty string)
- linkedin (LinkedIn URL if found, otherwise empty string)

Focus on: CEO, Managing Partner, Director, Partner, VP, Country Manager, or equivalent senior roles.

Reply with ONLY the JSON array. No markdown. No explanation. No text before or after the array.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search'
        }],
        system: `You are a B2B contact researcher. Search the web to find real people and their contact details at companies.
Always return ONLY a valid JSON array as your final response — no markdown, no preamble, just the array.
If you cannot find contacts, return an empty array: []`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `Anthropic API error ${r.status}: ${errText.slice(0, 300)}`, contacts: [] });
    }

    const data = await r.json();

    if (data.error) {
      return json({ error: data.error.message || 'API error', contacts: [] });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const contacts = parseContacts(text);
    return json({ contacts, source: sourceLabel });

  } catch (err) {
    return json({ error: err.message, contacts: [] });
  }
}

function parseContacts(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      return arr.map(c => ({
        name:     String(c.name     || c.full_name       || '').trim(),
        title:    String(c.title    || c.job_title        || c.position || '').trim(),
        email:    String(c.email    || c.email_address    || '').trim(),
        phone:    String(c.phone    || c.phone_number     || c.direct_phone || '').trim(),
        linkedin: String(c.linkedin || c.linkedin_url     || '').trim()
      })).filter(c => c.name.length > 0);
    }
  } catch (e) {
    console.error('Parse error:', e.message, '| text:', text.slice(0, 200));
  }
  return [];
}
