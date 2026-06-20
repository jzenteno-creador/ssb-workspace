// Netlify Function — proxy to Anthropic API for SSB Agent
// Keeps ANTHROPIC_API_KEY server-side (never exposed to browser)

const SYSTEM_PROMPT = `Sos un agente experto en logística marítima, tarifas de flete y comercio exterior para SSB International.
Tenés acceso a los datos del workspace SSB: tarifas BID, schedule de buques, EFA y detention.

Los datos se te pasan como CSV compacto.

Reglas:
- Respondé en español rioplatense con voseo.
- Sé conciso y directo (máximo 400 palabras).
- Cuando hables de tarifas, citá origen, destino, carrier y monto.
- Cuando hables de schedule, citá buque, naviera, ETD y ETA.
- Si te piden comparar, hacé tabla o lista clara.
- No inventes datos. Si no tenés la info, decilo.
- Podés hacer cálculos sobre los datos (promedios, totales, diferencias).`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY no configurada en Netlify.' }),
    };
  }

  try {
    const { messages, context } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'messages requerido' }),
      };
    }

    const systemWithContext = context
      ? SYSTEM_PROMPT + '\n\n' + context
      : SYSTEM_PROMPT;

    const anthropicMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemWithContext,
        messages: anthropicMessages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Anthropic API ${res.status}` }),
      };
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: text }),
    };
  } catch (e) {
    console.error('Chat function error:', e.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
}
