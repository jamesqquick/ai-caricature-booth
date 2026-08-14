type Prediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
};

const MODEL = 'google/nano-banana';
const MAX_WAIT_MS = 120_000;

export async function generateCaricature(token: string, selfie: Uint8Array, prompt: string) {
  const dataUrl = `data:image/jpeg;base64,${encodeBase64(selfie)}`;
  const response = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input: { prompt, image_input: [dataUrl], aspect_ratio: '3:2', output_format: 'jpg' } }),
  });
  if (!response.ok) throw new Error(`Replicate create failed: HTTP ${response.status}`);

  let prediction = (await response.json()) as Prediction;
  const started = Date.now();
  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() - started > MAX_WAIT_MS) throw new Error(`Replicate prediction timed out: ${prediction.id}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!poll.ok) throw new Error(`Replicate poll failed: HTTP ${poll.status}`);
    prediction = (await poll.json()) as Prediction;
  }
  if (prediction.status !== 'succeeded') throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`);

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new Error('Replicate returned no output image.');
  const output = await fetch(outputUrl);
  if (!output.ok || !output.body) throw new Error(`Replicate output fetch failed: HTTP ${output.status}`);
  return new Uint8Array(await output.arrayBuffer());
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
