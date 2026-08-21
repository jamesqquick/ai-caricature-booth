export type GenerationStatus =
  | "pending"
  | "uploading"
  | "moderating"
  | "generating"
  | "compositing"
  | "completed"
  | "errored";

export type GenerationPhase =
  "uploading" | "moderating" | "generating" | "compositing";

export const GENERATION_PROGRESS_DURATION_MS = 3000;

export const generationProgressRanges: Record<
  GenerationPhase,
  { start: number; target: number }
> = {
  uploading: { start: 0, target: 25 },
  moderating: { start: 25, target: 35 },
  generating: { start: 35, target: 72 },
  compositing: { start: 72, target: 92 },
};

export const generationPhases: Array<{ id: GenerationPhase; label: string }> = [
  { id: "uploading", label: "Uploading your photo" },
  { id: "moderating", label: "Checking your photo" },
  { id: "generating", label: "Creating your caricature" },
  { id: "compositing", label: "Building your postcard" },
];

export function phaseForGenerationStatus(
  status: GenerationStatus,
): GenerationPhase | null {
  if (status === "pending" || status === "uploading") return "uploading";
  if (status === "moderating") return "moderating";
  if (status === "generating") return "generating";
  if (status === "compositing") return "compositing";
  return null;
}

export function progressForPhase(phase: GenerationPhase, elapsedMs: number) {
  const { start, target } = generationProgressRanges[phase];
  const progress = Math.min(
    Math.max(elapsedMs / GENERATION_PROGRESS_DURATION_MS, 0),
    1,
  );
  return start + (target - start) * progress;
}
