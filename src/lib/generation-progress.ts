export type GenerationStatus = 'pending' | 'uploading' | 'generating' | 'compositing' | 'completed' | 'errored';

export type GenerationPhase = 'uploading' | 'generating' | 'compositing';

export const GENERATION_PROGRESS_DURATION_MS = 3000;

export const generationProgressRanges: Record<GenerationPhase, { start: number; target: number }> = {
  uploading: { start: 0, target: 25 },
  generating: { start: 33, target: 55 },
  compositing: { start: 66, target: 88 },
};

export const generationPhases: Array<{ id: GenerationPhase; label: string }> = [
  { id: 'uploading', label: 'Uploading your photo' },
  { id: 'generating', label: 'Creating your caricature' },
  { id: 'compositing', label: 'Building your postcard' },
];

export function phaseForGenerationStatus(status: GenerationStatus): GenerationPhase | null {
  if (status === 'pending' || status === 'uploading') return 'uploading';
  if (status === 'generating') return 'generating';
  if (status === 'compositing') return 'compositing';
  return null;
}

export function progressForPhase(phase: GenerationPhase, elapsedMs: number) {
  const { start, target } = generationProgressRanges[phase];
  const progress = Math.min(Math.max(elapsedMs / GENERATION_PROGRESS_DURATION_MS, 0), 1);
  return start + (target - start) * progress;
}
