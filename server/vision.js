// Share anything: one Claude vision call classifies a Pokémon GO screenshot and pulls out what the app needs.
// Returns null when no key is configured, so the rest of the server keeps working without it.
import Anthropic from '@anthropic-ai/sdk';

export const KINDS = ['battle_end', 'rocket', 'status', 'appraisal', 'storage', 'raid', 'trade', 'other'];

const SYSTEM = `You read screenshots from the mobile game Pokémon GO for a companion app. Classify the screenshot and extract
the facts listed below. Answer with ONE JSON object and nothing else, no markdown fences.

{
  "kind": one of "battle_end" (the results screen after a GO Battle League match: both teams' three Pokémon, a win/loss banner),
          "rocket" (a Team GO Rocket grunt or leader taunt, e.g. "Don't tangle with us!", or the Rocket balloon / PokéStop encounter),
          "status" (one Pokémon's status screen with CP, HP, name, moves), "appraisal" (the appraisal overlay with stat bars),
          "storage" (the Pokémon storage grid with many sprites), "raid" (a raid lobby or raid boss screen),
          "trade" (a trade offer screen), "other",
  "confidence": 0..1,
  "battle": {                       // only for kind battle_end, else null
    "result": "win" | "loss" | "draw" | null,
    "myTeam": [names in order, up to 3], "oppTeam": [names in order, up to 3],
    "myLead": name | null, "oppLead": name | null,
    "myFainted": 0..3 | null, "oppFainted": 0..3 | null,
    "ratingAfter": number | null, "ratingDelta": number | null
  },
  "rocket": {                       // only for kind rocket, else null
    "who": "grunt" | "Arlo" | "Cliff" | "Sierra" | "Giovanni" | null,
    "quote": the taunt text as written | null,
    "pokemon": [names visible, if any]
  },
  "summary": one short sentence about what the screenshot shows
}

Names: use the species name as the game shows it, with the form when visible ("Ninetales (Shadow)", "Stunfisk (Galarian)",
"Mega Beedrill"). If a name is unreadable use null, never guess. Left-to-right order on the results screen is the order the
Pokémon were used; the player's own team is on the left or top, the opponent's on the right or bottom.`;

export function makeVision(apiKey) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async function vision({ image, mediaType, hint }) {
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 800,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: hint ? `Text the on-device reader saw (may be partial): ${hint.slice(0, 600)}\n\nClassify and extract.` : 'Classify and extract.' },
      ] }],
    });
    if (msg.stop_reason === 'refusal') return { refused: true };
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { data: parseJson(text), model: msg.model, usage: { in: msg.usage && msg.usage.input_tokens, out: msg.usage && msg.usage.output_tokens } };
  };
}

export function parseJson(text) {              // tolerant: strips fences and anything around the outermost braces
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('the model did not answer with JSON');
  const o = JSON.parse(s.slice(a, b + 1));
  if (!KINDS.includes(o.kind)) o.kind = 'other';
  return o;
}
