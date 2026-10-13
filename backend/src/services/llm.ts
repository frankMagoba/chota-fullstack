import { config } from '../config.js';

/**
 * Optional LLM use: turn a booking state into a short, friendly status line
 * (English or Swahili). Behind the `llm_status_copy` flag, with a hard
 * timeout and a template fallback, so the booking flow never depends on it.
 */
export async function statusMessage(
  b: { status: string; service: string; driverName?: string; etaMinutes?: number | null },
  lang: 'en' | 'sw',
  useLlm: boolean,
): Promise<{ text: string; source: 'llm' | 'template' }> {
  const fallback = template(b, lang);
  if (!useLlm || !config.llm.apiKey) return { text: fallback, source: 'template' };
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(2500),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: 60,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              'Write one short, plain status update for a water/sewage truck customer in Nairobi. No emojis. Max 25 words.',
          },
          { role: 'user', content: JSON.stringify({ ...b, language: lang === 'sw' ? 'Swahili' : 'English' }) },
        ],
      }),
    });
    if (!res.ok) return { text: fallback, source: 'template' };
    const data = (await res.json()) as any;
    const text = String(data.choices?.[0]?.message?.content ?? '').trim();
    return text ? { text, source: 'llm' } : { text: fallback, source: 'template' };
  } catch {
    return { text: fallback, source: 'template' };
  }
}

function template(b: { status: string; service: string; driverName?: string; etaMinutes?: number | null }, lang: 'en' | 'sw') {
  const truck = b.service === 'water' ? 'water truck' : 'exhauster';
  const eta = b.etaMinutes != null ? ` about ${b.etaMinutes} min away` : '';
  if (lang === 'sw') {
    const map: Record<string, string> = {
      assigned: `${b.driverName ?? 'Dereva'} amekubali ombi lako.`,
      en_route: `${b.driverName ?? 'Dereva'} yuko njiani.`,
      arrived: 'Gari limefika.',
      completed: 'Kazi imekamilika. Asante!',
    };
    return map[b.status] ?? 'Tunatafuta gari karibu nawe.';
  }
  const map: Record<string, string> = {
    assigned: `${b.driverName ?? 'Your driver'} accepted your request.`,
    en_route: `Your ${truck} is on the way${eta ? ',' + eta : ''}.`,
    arrived: `Your ${truck} has arrived.`,
    completed: 'Job done. Thanks for using Chota.',
    no_driver: 'No trucks free nearby right now. Try again in a few minutes.',
  };
  return map[b.status] ?? 'Looking for a truck near you.';
}
