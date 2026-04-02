const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

const MCP_SERVERS = {
  apollo: 'https://mcp.apollo.io/mcp',
  clay:   'https://api.clay.com/v3/mcp',
  vibe:   'https://vibeprospecting.explorium.ai/mcp'
};

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed', contacts: [] }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON', contacts: [] }, 400); }

  const { org, domain, source } = body || {};
  if (!org || !source || !MCP_SERVERS[source]) {
    return json({ error: 'Missing or invalid parameters', contacts: [] }, 400);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set', contacts: [] }, 500);

  const prompt = `Search for contacts at "${org}"${domain ? ` (domain: ${domain})` : ''}.
Return up to 8 senior decision-makers as a JSON array only.
Fields: name, title, email, phone, linkedin.
No markdown. No explanation. Only the array.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        mcp_servers: [{ type: 'url', url: MCP_SERVERS[source], name: source }],
        system: 'You are a contact finder. Use MCP tools to find contacts. Reply ONLY with a JSON array, nothing else.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    // Check if response is ok
    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `Anthropic API error ${r.status}: ${errText.slice(0, 200)}`, contacts: [] });
    }

    const data = await r.json();

    if (data.error) {
      return json({ error: data.error.message || 'API error', contacts: [] });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return json({ contacts: parseContacts(text), raw: text.slice(0, 500) });

  } catch (err) {
    return json({ error: err.message, contacts: [] });
  }
}

function parseContacts(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]).map(c => ({
        name:     c.name     || c.full_name       || '',
        title:    c.title    || c.job_title        || c.position || '',
        email:    c.email    || c.email_address    || '',
        phone:    c.phone    || c.phone_number     || c.direct_phone || '',
        linkedin: c.linkedin || c.linkedin_url     || ''
      })).filter(c => c.name);
    }
  } catch (e) { console.error('Parse error:', e, text); }
  return [];
}
