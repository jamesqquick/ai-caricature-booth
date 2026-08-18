import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { actions } from 'astro:actions';
import { AlertCircle, Check } from 'lucide-react';
import type { Scene } from '../../data/scenes';
import { GENERATION_PROGRESS_DURATION_MS, generationPhases, generationProgressRanges, phaseForGenerationStatus, progressForPhase, type GenerationPhase } from '../../lib/generation-progress';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Card } from '../ui/card';
import { Progress } from '../ui/progress';

type Props = {
  scene: Scene;
  photoDataUrl: string;
  eventSlug: string;
  onComplete: (sessionId: string) => void;
};

export function GeneratingStep({ scene, photoDataUrl, eventSlug, onComplete }: Props) {
  const [activePhase, setActivePhase] = useState<GenerationPhase>('uploading');
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();

  useEffect(() => {
    if (isComplete) return;

    const range = generationProgressRanges[activePhase];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(range.target);
      return;
    }

    setProgress(range.start);
    const startedAt = performance.now();
    let animationFrame = 0;
    const animate = (now: number) => {
      setProgress(progressForPhase(activePhase, now - startedAt));
      if (now - startedAt < GENERATION_PROGRESS_DURATION_MS) animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activePhase, isComplete]);

  useEffect(() => {
    let active = true;
    async function start() {
      const blob = await (await fetch(photoDataUrl)).blob();
      const form = new FormData();
      form.set('eventSlug', eventSlug);
      form.set('sceneId', scene.id);
      form.set('idempotencyKey', idempotencyKeyRef.current!);
      form.set('selfie', new File([blob], 'selfie.jpg', { type: 'image/jpeg' }));
      const started = await actions.startGeneration(form);
      if (started.error || !started.data) throw new Error(started.error?.message ?? 'Could not start generation.');
      const startedPhase = phaseForGenerationStatus(started.data.status);
      if (startedPhase) setActivePhase(startedPhase);
      let pollFailures = 0;
      while (active) {
        const status = await actions.getGeneration({ sessionId: started.data.sessionId });
        if (status.error || !status.data) {
          pollFailures += 1;
          if (pollFailures >= 3) throw new Error(status.error?.message ?? 'Could not read generation status.');
          await new Promise((resolve) => window.setTimeout(resolve, pollFailures * 1000));
          continue;
        }
        pollFailures = 0;
        if (status.data.status === 'completed') {
          setActivePhase('compositing');
          setProgress(100);
          setIsComplete(true);
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          if (!active) return;
          onComplete(started.data.sessionId);
          return;
        }
        if (status.data.status === 'errored') throw new Error(status.data.error ?? 'Generation failed.');
        const phase = phaseForGenerationStatus(status.data.status);
        if (phase) setActivePhase(phase);
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
    }
    void start().catch((error) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : 'Generation failed. Please try again.');
    });
    return () => { active = false; };
  }, [eventSlug, onComplete, photoDataUrl, scene.id]);

  const activeIndex = generationPhases.findIndex(({ id }) => id === activePhase);

  return (
    <div className="step-enter grid w-full max-w-[64rem] grid-cols-[minmax(17rem,28rem)_minmax(18rem,1fr)] items-center gap-[clamp(2rem,7vw,7rem)] max-[800px]:grid-cols-1 max-[800px]:mx-auto max-[800px]:max-w-md max-[800px]:gap-8">
      <Card className="generation-preview relative aspect-[4/5] w-full rotate-[-2deg] overflow-hidden rounded-[1.2rem] border-border bg-card" data-phase={activePhase} style={{ '--scene-accent': scene.accent } as CSSProperties}>
        <img className="size-full object-cover grayscale-[.65] contrast-[1.15]" src={photoDataUrl} alt="Your photo being prepared" />
        <div className="ink-scan" aria-hidden="true" />
        <Badge className="absolute bottom-4 right-4 rotate-[-3deg] border-current bg-[oklch(15%_.018_55)] font-label text-[.58rem] font-extrabold uppercase tracking-[.15em] text-foreground">{generationPhases[activeIndex].label}</Badge>
      </Card>

      <div>
        <p className="mb-3.5 font-label text-[.72rem] font-extrabold uppercase tracking-[.22em] text-primary">Creating {scene.name}</p>
        <h1 className="mb-6 max-w-[13ch] font-display text-[clamp(2.6rem,6vw,5rem)] font-semibold leading-[.92] tracking-[-.06em]" tabIndex={-1}>Drawing outside the lines.</h1>
        <p className="m-0 max-w-[38rem] text-[clamp(.95rem,1.5vw,1.12rem)] leading-[1.65] text-muted-foreground">Your approved photo is uploaded privately, then transformed into a print-ready postcard.</p>
        {errorMessage && (
          <Alert className="mt-6 flex max-w-[38rem] items-start gap-3 border-danger/40 bg-danger/10 text-danger">
            <AlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <AlertTitle>We could not finish that postcard.</AlertTitle>
              <AlertDescription className="text-foreground/80"><p>{errorMessage}</p></AlertDescription>
              <Button className="mt-3" variant="secondary" type="button" onClick={() => window.location.reload()}>Try again</Button>
            </div>
          </Alert>
        )}
        <Progress className="mt-8" indicatorClassName="generation-progress-indicator" value={isComplete ? 100 : progress} aria-label="Generation progress" />
        <ol className="mt-8 flex list-none flex-col gap-2 m-0 p-0">
          {generationPhases.map(({ id, label }, index) => {
            const completed = isComplete || index < activeIndex;
            const active = !isComplete && index === activeIndex;
            return (
              <li
                className={`flex items-center gap-3 border-b border-border py-3 text-muted-foreground transition-colors ${active ? 'text-primary' : completed ? 'text-success' : ''}`}
                aria-current={active ? 'step' : undefined}
                aria-label={`${label}, ${active ? 'in progress' : completed ? 'completed' : 'upcoming'}`}
                key={id}
              >
                <span className="grid size-6 place-items-center rounded-full border border-current text-[.63rem]">{completed ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : index + 1}</span>
                <strong>
                  {label}
                  {active && <span className="sr-only"> (in progress)</span>}
                </strong>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
