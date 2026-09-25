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
  "pokemon": {                      // only for kind status or appraisal, else null
    "name": the species as the game shows it, form in parentheses when visible | null,
    "cp": the CP number | null when it is not on screen (a screen scrolled down to the attacks),
    "hp": current HP | null, "hpMax": maximum HP (the number after the slash) | null,
    "fast": the fast attack's name as shown | null, "charged": [the charged attacks' names as shown, 0..2],
    "newAttack": true when the NEW ATTACK button to unlock a second charged attack is visible, else false,
    "ivs": [attack, defense, hp], each 0..15, only on the appraisal overlay and only when the bars are clearly readable | null
  },
  "summary": one short sentence about what the screenshot shows,
  "notes": []                       // only for a recording (several frames): see below
}

When you receive SEVERAL frames, they are sampled in time order from a screen recording of one GO Battle League match; each
frame is labelled with its time in seconds. Then kind is "battle_end" when it is a battle: fill "battle" from the whole
recording (teams in order of appearance, the result from the final frames, faint counts) and add up to 3 "notes", each
{"t": seconds, "text": one sentence} about a decision that decided the match: a charged move thrown into a shield, a switch
that lost the lead, energy left unused when a Pokémon fainted, a shield not used. Be concrete, name the Pokémon and the move
when readable, never invent what the frames do not show. If the recording is not a battle, classify the most informative
frame as above.

Names: use the species name as the game shows it, with the form when visible ("Ninetales (Shadow)", "Stunfisk (Galarian)",
"Mega Beedrill"). If a name is unreadable use null, never guess. Left-to-right order on the results screen is the order the
Pokémon were used; the player's own team is on the left or top, the opponent's on the right or bottom.`;

export function makeVision(apiKey) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async function vision({ image, mediaType, images, hint }) {
    const frames = images && images.length ? images : [{ image, mediaType }];
    const content = [];
    frames.forEach((f, i) => {
      if (frames.length > 1) content.push({ type: 'text', text: `Frame ${i + 1} of ${frames.length}${f.t != null ? ` at ${f.t}s` : ''}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType || 'image/jpeg', data: f.image } });
    });
    content.push({ type: 'text', text: (hint ? `Text the on-device reader saw (may be partial): ${hint.slice(0, 600)}\n\n` : '') + (frames.length > 1 ? 'These frames come from one screen recording. Classify and extract; add the notes when it is a battle.' : 'Classify and extract.') });
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: frames.length > 1 ? 1200 : 800,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: frames.length > 1 ? 'medium' : 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
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
