export const GENERATION_FAILURE_CODES = [
  'photo_rejected',
  'moderation_unavailable',
  'generation_failed',
  'composition_failed',
  'unknown_failure',
] as const;

export type GenerationFailureCode = (typeof GENERATION_FAILURE_CODES)[number];

export type GenerationFailureContent = {
  message: string;
  retryable: boolean;
};

export const generationFailureContent = {
  photo_rejected: {
    message: "We couldn't use this photo after the safety check. Try a different photo.",
    retryable: true,
  },
  moderation_unavailable: {
    message: "We couldn't check your photo. Please try again.",
    retryable: true,
  },
  generation_failed: {
    message: "We couldn't create your caricature. Please try again.",
    retryable: true,
  },
  composition_failed: {
    message: "We couldn't finish your postcard. Please try again.",
    retryable: true,
  },
  unknown_failure: {
    message: "We couldn't create your postcard. Please try again.",
    retryable: true,
  },
} as const satisfies Record<GenerationFailureCode, GenerationFailureContent>;

const legacyFailureCodes = new Map<string, GenerationFailureCode>([
  [generationFailureContent.photo_rejected.message, 'photo_rejected'],
  [generationFailureContent.moderation_unavailable.message, 'moderation_unavailable'],
  [generationFailureContent.generation_failed.message, 'generation_failed'],
  [generationFailureContent.composition_failed.message, 'composition_failed'],
]);

export function isGenerationFailureCode(value: unknown): value is GenerationFailureCode {
  return typeof value === 'string' && GENERATION_FAILURE_CODES.includes(value as GenerationFailureCode);
}

export function toGenerationFailureCode(errorCode: unknown, legacyMessage: unknown): GenerationFailureCode {
  if (isGenerationFailureCode(errorCode)) return errorCode;
  if (typeof legacyMessage === 'string') return legacyFailureCodes.get(legacyMessage) ?? 'unknown_failure';
  return 'unknown_failure';
}
