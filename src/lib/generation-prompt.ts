export const GENERATION_SAFETY_INSTRUCTION = 'Keep the person recognizable, expressive, and centered. No text.';

export type GenerationPromptParts = {
  preamble?: string | null;
  scenePrompt: string;
  sceneDescription?: string;
  constraints?: string | null;
};

export function composeGenerationPrompt(parts: GenerationPromptParts) {
  return [
    parts.preamble?.trim(),
    parts.scenePrompt.trim(),
    parts.sceneDescription?.trim(),
    parts.constraints?.trim(),
    GENERATION_SAFETY_INSTRUCTION,
  ].filter(Boolean).join(' ');
}
