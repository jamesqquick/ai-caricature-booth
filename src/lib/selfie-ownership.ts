export type SelfieOwnership = {
  sessionId: string;
  eventId: number;
  workflowInstanceId: string;
  selfieSha256: string;
};

export function hasExactSelfieOwnership(
  object: Pick<R2Object, 'httpMetadata' | 'customMetadata'> | null | undefined,
  expected: SelfieOwnership,
) {
  return object?.httpMetadata?.contentType === 'image/jpeg'
    && object.customMetadata?.sessionId === expected.sessionId
    && object.customMetadata?.eventId === String(expected.eventId)
    && object.customMetadata?.workflowInstanceId === expected.workflowInstanceId
    && object.customMetadata?.assetKind === 'selfie'
    && object.customMetadata?.selfieSha256 === expected.selfieSha256;
}
