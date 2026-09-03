const PRINT_CAPABILITY_TTL_SECONDS = 2 * 60 * 60;

type PrintCapabilityBinding = {
  sessionId: string;
  eventId: number;
};

type PrintCapabilityPayload = PrintCapabilityBinding & {
  version: 1;
  expiresAt: number;
};

export class PrintCapabilityConfigurationError extends Error {
  readonly name = 'PrintCapabilityConfigurationError';
}

export class PrintCapabilityInvalidError extends Error {
  readonly name = 'PrintCapabilityInvalidError';

  constructor() {
    super('Print capability is invalid.');
  }
}

export class PrintCapabilityExpiredError extends Error {
  readonly name = 'PrintCapabilityExpiredError';

  constructor() {
    super('Print capability has expired.');
  }
}

export async function issuePrintCapability(
  secret: string,
  binding: PrintCapabilityBinding,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const payload: PrintCapabilityPayload = {
    version: 1,
    sessionId: binding.sessionId,
    eventId: binding.eventId,
    expiresAt: nowSeconds + PRINT_CAPABILITY_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret), new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPrintCapability(
  secret: string,
  token: unknown,
  binding: PrintCapabilityBinding,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<PrintCapabilityPayload> {
  if (typeof token !== 'string') throw new PrintCapabilityInvalidError();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new PrintCapabilityInvalidError();

  let signature: Uint8Array;
  let payload: unknown;
  try {
    signature = decodeBase64Url(parts[1]);
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
  } catch {
    throw new PrintCapabilityInvalidError();
  }

  const validSignature = await crypto.subtle.verify(
    'HMAC',
    await importKey(secret),
    signature.buffer as ArrayBuffer,
    new TextEncoder().encode(parts[0]),
  );
  if (!validSignature || !isPayload(payload)) throw new PrintCapabilityInvalidError();
  if (payload.sessionId !== binding.sessionId || payload.eventId !== binding.eventId) {
    throw new PrintCapabilityInvalidError();
  }
  if (payload.expiresAt < nowSeconds) throw new PrintCapabilityExpiredError();
  return payload;
}

function isPayload(value: unknown): value is PrintCapabilityPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<PrintCapabilityPayload>;
  return payload.version === 1
    && typeof payload.sessionId === 'string'
    && Number.isSafeInteger(payload.eventId)
    && typeof payload.expiresAt === 'number'
    && Number.isSafeInteger(payload.expiresAt);
}

async function importKey(secret: string) {
  if (!secret) throw new PrintCapabilityConfigurationError('PRINT_CAPABILITY_SECRET is required.');
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new PrintCapabilityInvalidError();
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
