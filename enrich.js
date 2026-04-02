export const config = { runtime: 'edge' };

const MCP_SERVERS = {
  apollo: 'https://mcp.apollo.io/mcp',
  clay:   'https://api.clay.com/v3/mcp',
  vibe:   'https://vibeprospecting.explorium.ai/mcp'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const { org, domain, source } = body;

  if (!org || !source || !MCP_SERVERS[source]) {
    return new Response(JSON.stringify({ error: 'Missing or invalid parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const prompt = `Search for contacts at company "${org}"${domain ? ` with domain "${domain}"` : ''}. 
Return up to 8 senior decision-makers (C-suite, Managing Partners, Directors, VPs).
Respond ONLY with a valid JSON array, no markdown, no explanation.
Each item must have: name, title, email, phone, linkedin.
Example: [{"name":"João Silva","title":"Managing Partner","email":"j.silva@firm.pt","phone":"+351 210 000 000","linkedin":"https://linkedin.com/in/joaosilva"}]`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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
        mcp_servers: [{
          type: 'url',
          url: MCP_SERVERS[source],
          name: source
        }],
        system: 'You are a contact research assistant. Use the available MCP tools to find business contacts. Always respond with ONLY a valid JSON array, no other text.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await anthropicRes.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message, contacts: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const contacts = parseContacts(text);

    return new Response(JSON.stringify({ contacts }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, contacts: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

function parseContacts(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]).map(c => ({
        name:     c.name     || c.full_name  || '',
        title:    c.title    || c.job_title  || c.position || '',
        email:    c.email    || c.email_address || '',
        phone:    c.phone    || c.phone_number  || c.direct_phone || '',
        linkedin: c.linkedin || c.linkedin_url  || ''
      })).filter(c => c.name);
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
  return [];
}
