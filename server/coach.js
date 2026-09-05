// The coach: one Claude call that turns the app's roster/meta summary into advice. Returns null when no key is configured,
// so the rest of the server keeps working without it.
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are a Pokémon GO Great League (1500 CP) coach for a casual player who wants to enjoy battling, not grind.
You get a JSON summary from the PokeScan app: the Pokémon the player owns (with PvPoke rank and moves), pieces they are still
building ("pending"), species they want, the app's best-scoring teams, their saved in-game parties, the next moves the app
suggests, and the current top meta. Team scores come from a heuristic described in the summary; treat them as a guide.

Answer in short markdown, under 350 words:
- Start with 2 or 3 concrete teams from what the player OWNS: lead / safe swap / closer, and one line why each works.
- Then "Build next": the one or two pending/wanted Pokémon that would improve those teams most, and what they fix.
- Then "Watch out for": the meta Pokémon those teams struggle against and what to swap to when you meet them.
- If the player asked a question, answer it first, briefly, using the same data.
Only name Pokémon that appear in the summary, unless you mark them clearly as "to catch or build". Do not invent stats,
moves or matchups; when unsure, say what the app's numbers show. No preamble, no closing offer.`;

export function makeCoach(apiKey) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async function coach({ context, question }) {
    const user = `${question ? `Question: ${question}\n\n` : ''}Roster and meta summary (JSON):\n${context}`;
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    if (msg.stop_reason === 'refusal') return { refused: true };
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { text, model: msg.model, usage: { in: msg.usage && msg.usage.input_tokens, out: msg.usage && msg.usage.output_tokens } };
  };
}
