export type ModerationVerdict = {
  safe: boolean;
  reasons: string[];
  raw: string;
  elapsedMs: number;
};

const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const MODERATION_SYSTEM_PROMPT = `You are a strict SFW content moderation system for a public photo booth at a corporate event.
Examine the provided image and decide whether it is SAFE to use as the input photo for an AI caricature generator that will be printed as a postcard and displayed on a public screen.

Reject the image as UNSAFE if it contains any of:
- nudity or sexual content
- graphic violence, gore, or weapons aimed at people
- hate symbols or extremist imagery
- illegal drug use
- offensive gestures or visible profanity
- text overtly promoting violence, hate, or harassment

Allow ordinary selfies and group selfies, costumes and character imagery, hats and sunglasses, silly faces, blur, and unusual camera angles.

Respond with ONLY one JSON object in this exact shape: {"safe": true} or {"safe": false, "reasons": ["short reason"]}.`;

async function acceptLlamaVisionLicense(ai: Ai): Promise<void> {
  try {
    await ai.run(MODEL, { prompt: 'agree' });
  } catch (error) {
    if (String(error).includes('Thank you for agreeing')) return;
    throw error;
  }
}

function parseVerdict(response: unknown) {
  const value = response && typeof response === 'object' && 'response' in response
    ? (response as { response: unknown }).response
    : response;
  if (value && typeof value === 'object') return value as { safe?: unknown; reasons?: unknown };
  if (typeof value === 'string') {
    const match = value.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as { safe?: unknown; reasons?: unknown };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function moderateImage(ai: Ai, imageBytes: Uint8Array): Promise<ModerationVerdict> {
  const started = Date.now();
  const image = Array.from(imageBytes);
  let response: unknown;

  try {
    response = await ai.run(MODEL, {
      messages: [
        { role: 'system', content: MODERATION_SYSTEM_PROMPT },
        { role: 'user', content: 'Is this image safe? Reply with the JSON verdict.' },
      ],
      image,
      max_tokens: 256,
    });
  } catch (error) {
    const message = String(error);
    if (message.includes('5016') && message.toLowerCase().includes('agree')) {
      await acceptLlamaVisionLicense(ai);
      response = await ai.run(MODEL, {
        messages: [
          { role: 'system', content: MODERATION_SYSTEM_PROMPT },
          { role: 'user', content: 'Is this image safe? Reply with the JSON verdict.' },
        ],
        image,
        max_tokens: 256,
      });
    } else {
      throw error;
    }
  }

  const parsed = parseVerdict(response);
  const safe = parsed?.safe === true;
  const reasons = Array.isArray(parsed?.reasons) ? parsed.reasons.map(String) : [];
  if (parsed && !safe && reasons.length === 0) reasons.push('model returned safe=false with no reasons');
  return {
    safe,
    reasons: parsed ? reasons : ['could not parse verdict'],
    raw: JSON.stringify(response),
    elapsedMs: Date.now() - started,
  };
}
