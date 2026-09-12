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

const SYSTEM_BUILDER = `You are a Pokémon GO Great League (1500 CP) coach for a casual player. The player is building one team in the
PokeScan team builder. The JSON summary has a "builder" object: the slots filled so far (1 to 3 Pokémon with the moves used for
scoring), the meta Pokémon those slots leave unanswered ("weakSpots"), and the app's own candidates for the open slots, from
the player's roster and from the meta, each with the team score it would give. It also has the player's roster, pending and
wanted Pokémon and the current top meta.

Answer in short markdown, under 300 words:
- If fewer than 3 slots are filled: propose 2 or 3 ways to complete the team. Prefer Pokémon the player OWNS; anything not owned
  must be marked "to catch or build". For each: which weak spots it closes, and who leads / swaps / closes.
- If 3 slots are filled: judge the team in one paragraph (roles, what it fears, one swap that would help), then stop.
- If the player asked a question, answer it first, briefly.
Only name Pokémon that appear in the summary. Do not invent stats, moves or matchups; lean on the app's numbers. No preamble,
no closing offer.`;

const SYSTEM_REVIEW = `You are a Pokémon GO PvP coach for a casual player. The JSON summary has a "builder" object with a complete team of
three (slots with the moves used for scoring), the meta Pokémon it leaves unanswered ("weakSpots"), the meta Pokémon that beat two
of the three, the player's roster and the current top meta. The league and CP cap are named in the summary.

Review the team in markdown with exactly these four sections, under 180 words in total, no other text:
**Verdict** one sentence: how good this team is and its main idea.
**Strengths** up to 3 bullets: what it handles well, who leads / swaps / closes.
**Weak spots** up to 3 bullets: the meta Pokémon or patterns it fears, and what to do when you meet them.
**Swaps** up to 2 bullets, each "X → Y: why", preferring Pokémon the player OWNS (mark others "to catch or build"). Write "none" if the team should stay as it is.
Only name Pokémon that appear in the summary. Do not invent stats, moves or matchups; lean on the app's numbers.`;

export function makeCoach(apiKey) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async function coach({ context, question, mode }) {
    const user = `${question ? `Question: ${question}\n\n` : ''}Roster and meta summary (JSON):\n${context}`;
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: mode === 'review' ? 1500 : 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: mode === 'builder' ? SYSTEM_BUILDER : mode === 'review' ? SYSTEM_REVIEW : SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    if (msg.stop_reason === 'refusal') return { refused: true };
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { text, model: msg.model, usage: { in: msg.usage && msg.usage.input_tokens, out: msg.usage && msg.usage.output_tokens } };
  };
}
