export type SelfieOwnership = {
  sessionId: string;
  eventId: number;
  workflowInstanceId: string;
  selfieSha256: string;
};

export type SessionAssetKind = 'selfie' | 'caricature' | 'postcard';

type AssetOwnership = Omit<SelfieOwnership, 'selfieSha256'> & {
  assetKind: SessionAssetKind;
};

type PostcardOwnership = Omit<AssetOwnership, 'assetKind' | 'workflowInstanceId'> & {
  workflowInstanceId: string | null;
};

const JPEG_CONTENT_TYPE = 'image/jpeg';
const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function workflowSessionAssetKey(sessionId: string, workflowInstanceId: string, assetKind: SessionAssetKind) {
  return `sessions/${sessionId}/${workflowInstanceId}/${assetKind}.jpg`;
}

export function legacySessionAssetKey(sessionId: string, assetKind: SessionAssetKind) {
  return `sessions/${sessionId}/${assetKind}.jpg`;
}

export function isOwnedSessionAssetKey(sessionId: string, assetKind: SessionAssetKind, key: string) {
  if (key === legacySessionAssetKey(sessionId, assetKind)) return true;
  const parts = key.split('/');
  return parts.length === 4
    && parts[0] === 'sessions'
    && parts[1] === sessionId
    && WORKFLOW_ID_PATTERN.test(parts[2] ?? '')
    && parts[3] === `${assetKind}.jpg`;
}

export function hasExactSessionAssetOwnership(
  object: Pick<R2Object, 'httpMetadata' | 'customMetadata'> | null | undefined,
  expected: AssetOwnership,
) {
  return object?.httpMetadata?.contentType === JPEG_CONTENT_TYPE
    && object.customMetadata?.sessionId === expected.sessionId
    && object.customMetadata?.eventId === String(expected.eventId)
    && object.customMetadata?.workflowInstanceId === expected.workflowInstanceId
    && object.customMetadata?.assetKind === expected.assetKind;
}

export function hasExactSelfieOwnership(
  object: Pick<R2Object, 'httpMetadata' | 'customMetadata'> | null | undefined,
  expected: SelfieOwnership,
) {
  return hasExactSessionAssetOwnership(object, { ...expected, assetKind: 'selfie' })
    && object?.customMetadata?.selfieSha256 === expected.selfieSha256;
}

export async function readOwnedSelfieBytes(
  object: R2ObjectBody,
  key: string,
  expected: SelfieOwnership,
) {
  if (key === workflowSessionAssetKey(expected.sessionId, expected.workflowInstanceId, 'selfie')) {
    return hasExactSelfieOwnership(object, expected) ? new Uint8Array(await object.arrayBuffer()) : null;
  }
  if (key !== legacySessionAssetKey(expected.sessionId, 'selfie')) return null;
  return loadLegacyOwnedSelfieBytes(object, expected);
}

export async function loadLegacyOwnedSelfieBytes(object: R2ObjectBody, expected: SelfieOwnership) {
  if (object.httpMetadata?.contentType && object.httpMetadata.contentType !== JPEG_CONTENT_TYPE) return null;
  if (hasConflictingMetadata(object.customMetadata, { ...expected, assetKind: 'selfie' })) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return await hashBytes(bytes) === expected.selfieSha256 ? bytes : null;
}

export function hasOwnedPostcard(
  object: Pick<R2Object, 'key' | 'httpMetadata' | 'customMetadata'> | null | undefined,
  key: string,
  expected: PostcardOwnership,
) {
  if (!object || object.key !== key) return false;
  const workflowInstanceId = expected.workflowInstanceId;
  if (workflowInstanceId && key === workflowSessionAssetKey(expected.sessionId, workflowInstanceId, 'postcard')) {
    return hasExactSessionAssetOwnership(object, { ...expected, workflowInstanceId, assetKind: 'postcard' });
  }
  return key === legacySessionAssetKey(expected.sessionId, 'postcard')
    && hasLegacyOwnedPostcard(object, expected);
}

export function hasLegacyOwnedPostcard(
  object: Pick<R2Object, 'httpMetadata' | 'customMetadata'>,
  expected: PostcardOwnership,
) {
  const contentType = object.httpMetadata?.contentType;
  return (!contentType || contentType === JPEG_CONTENT_TYPE)
    && !hasConflictingMetadata(object.customMetadata, { ...expected, assetKind: 'postcard' });
}

function hasConflictingMetadata(
  metadata: Record<string, string> | undefined,
  expected: Omit<AssetOwnership, 'workflowInstanceId'> & { workflowInstanceId: string | null; selfieSha256?: string },
) {
  if (!metadata) return false;
  const fields = {
    sessionId: expected.sessionId,
    eventId: String(expected.eventId),
    assetKind: expected.assetKind,
    ...(expected.selfieSha256 ? { selfieSha256: expected.selfieSha256 } : {}),
  };
  return Object.entries(fields).some(([name, value]) => metadata[name] !== undefined && metadata[name] !== value)
    || (metadata.workflowInstanceId !== undefined && metadata.workflowInstanceId !== expected.workflowInstanceId);
}

async function hashBytes(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
