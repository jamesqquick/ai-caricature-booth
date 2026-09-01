import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import type { PublicScene } from '../../data/scenes';
import { generationFailureContent, isGenerationFailureCode, type GenerationFailureCode } from '../../lib/generation-errors';
import { GENERATION_PROGRESS_DURATION_MS, generationPhases, generationProgressRanges, phaseForGenerationStatus, progressForPhase, type GenerationPhase, type GenerationStatus } from '../../lib/generation-progress';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Card } from '../ui/card';
import { Progress } from '../ui/progress';

type Props = {
  scene: PublicScene;
  photoDataUrl: string;
  eventSlug: string;
  onComplete: (sessionId: string) => void;
  onChooseAnotherPhoto: () => void;
  generationActions: GenerationActions;
};

type ActionResult<T> = {
  data?: T;
  error?: unknown;
};

export type GenerationActions = {
  startGeneration: (form: FormData) => Promise<ActionResult<{ sessionId: string; status: GenerationStatus }>>;
  getGeneration: (input: { sessionId: string }) => Promise<ActionResult<{
    status: GenerationStatus;
    failureCode?: unknown;
    postcardUrl?: string | null;
  }>>;
};

type GenerationIssue =
  | { kind: 'terminal'; code: GenerationFailureCode }
  | { kind: 'connection_lost'; sessionId: string }
  | { kind: 'start_failure'; idempotencyKey: string };

type GenerationRun =
  | { kind: 'start'; idempotencyKey: string; nonce: number }
  | { kind: 'poll'; sessionId: string; nonce: number };

const issueContent = {
  terminal: {
    title: "We couldn't finish that postcard.",
  },
  connection_lost: {
    title: 'We lost the connection.',
    message: 'Your postcard may still be processing. Check again to see if it is ready.',
  },
  start_failure: {
    title: "We couldn't start your postcard.",
    message: "We couldn't confirm whether your photo was submitted. Try again to safely continue the same request.",
  },
} as const;

const issueActionLabels = {
  retry: 'Try again',
  check: 'Check again',
  anotherPhoto: 'Choose another photo',
} as const;

const pausedGenerationContent = {
  badge: 'Needs attention',
  progress: 'Paused for recovery',
} as const;

function waitForDelay(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const finish = (completed: boolean) => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const timeoutId = window.setTimeout(() => finish(true), delayMs);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function GeneratingStep({ scene, photoDataUrl, eventSlug, onComplete, onChooseAnotherPhoto, generationActions }: Props) {
  const [activePhase, setActivePhase] = useState<GenerationPhase>('uploading');
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [issue, setIssue] = useState<GenerationIssue | null>(null);
  const [run, setRun] = useState<GenerationRun>(() => ({
    kind: 'start',
    idempotencyKey: crypto.randomUUID(),
    nonce: 0,
  }));
  const issueHeadingRef = useRef<HTMLHeadingElement>(null);
  const completeGeneration = useEffectEvent(onComplete);

  useEffect(() => {
    if (isComplete || issue) return;

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
  }, [activePhase, isComplete, issue]);

  useEffect(() => {
    const controller = new AbortController();

    async function poll(sessionId: string) {
      let pollFailures = 0;
      while (!controller.signal.aborted) {
        let status: Awaited<ReturnType<GenerationActions['getGeneration']>> | null = null;
        try {
          status = await generationActions.getGeneration({ sessionId });
        } catch {
          // A poll exception is treated the same as an action-level poll failure.
        }
        if (controller.signal.aborted) return;
        if (!status || status.error || !status.data) {
          pollFailures += 1;
          if (pollFailures >= 3) {
            setIssue({ kind: 'connection_lost', sessionId });
            return;
          }
          if (!await waitForDelay(pollFailures * 1000, controller.signal)) return;
          continue;
        }
        pollFailures = 0;
        if (status.data.status === 'completed') {
          setActivePhase('compositing');
          setProgress(100);
          setIsComplete(true);
          if (!await waitForDelay(1000, controller.signal)) return;
          completeGeneration(sessionId);
          return;
        }
        if (status.data.status === 'errored') {
          const failureCode = isGenerationFailureCode(status.data.failureCode) ? status.data.failureCode : 'unknown_failure';
          setIssue({ kind: 'terminal', code: failureCode });
          return;
        }
        const phase = phaseForGenerationStatus(status.data.status);
        if (phase) setActivePhase(phase);
        if (!await waitForDelay(2000, controller.signal)) return;
      }
    }

    async function start() {
      if (run.kind === 'poll') {
        await poll(run.sessionId);
        return;
      }

      try {
        const blob = await (await fetch(photoDataUrl, { signal: controller.signal })).blob();
        if (controller.signal.aborted) return;
        const form = new FormData();
        form.set('eventSlug', eventSlug);
        form.set('sceneId', scene.id);
        form.set('idempotencyKey', run.idempotencyKey);
        form.set('selfie', new File([blob], 'selfie.jpg', { type: 'image/jpeg' }));
        const started = await generationActions.startGeneration(form);
        if (controller.signal.aborted) return;
        if (started.error || !started.data) {
          setIssue({ kind: 'start_failure', idempotencyKey: run.idempotencyKey });
          return;
        }
        const startedPhase = phaseForGenerationStatus(started.data.status);
        if (startedPhase) setActivePhase(startedPhase);
        await poll(started.data.sessionId);
      } catch {
        if (!controller.signal.aborted) setIssue({ kind: 'start_failure', idempotencyKey: run.idempotencyKey });
      }
    }

    void start();
    return () => controller.abort();
  }, [eventSlug, generationActions, photoDataUrl, run, scene.id]);

  useEffect(() => {
    if (issue) issueHeadingRef.current?.focus();
  }, [issue]);

  const resetProgress = () => {
    setActivePhase('uploading');
    setProgress(0);
    setIsComplete(false);
    setIssue(null);
  };

  const retryGeneration = () => {
    if (!issue || issue.kind === 'connection_lost' || (issue.kind === 'terminal' && issue.code === 'photo_rejected')) return;
    const idempotencyKey = issue.kind === 'start_failure' ? issue.idempotencyKey : crypto.randomUUID();
    resetProgress();
    setRun((current) => ({ kind: 'start', idempotencyKey, nonce: current.nonce + 1 }));
  };

  const checkGeneration = () => {
    if (issue?.kind !== 'connection_lost') return;
    const { sessionId } = issue;
    resetProgress();
    setRun((current) => ({ kind: 'poll', sessionId, nonce: current.nonce + 1 }));
  };

  const activeIndex = generationPhases.findIndex(({ id }) => id === activePhase);
  const visibleIssueContent = issue?.kind === 'terminal'
    ? { ...issueContent.terminal, message: generationFailureContent[issue.code].message }
    : issue ? issueContent[issue.kind] : null;

  return (
    <div className="step-enter grid w-full max-w-[64rem] grid-cols-[minmax(17rem,28rem)_minmax(18rem,1fr)] items-center gap-[clamp(2rem,7vw,7rem)] max-[800px]:grid-cols-1 max-[800px]:mx-auto max-[800px]:max-w-md max-[800px]:gap-8">
      <Card className="generation-preview relative aspect-[4/5] w-full rotate-[-2deg] overflow-hidden rounded-[1.2rem] border-border bg-card" data-phase={issue ? undefined : activePhase}>
        <img className="size-full object-cover grayscale-[.65] contrast-[1.15]" src={photoDataUrl} alt="Your photo being prepared" />
        {!issue && !isComplete && <div className="ink-scan" aria-hidden="true" />}
        <Badge className="absolute bottom-4 right-4 rotate-[-3deg] border-current bg-[oklch(15%_.018_55)] font-label text-[.58rem] font-extrabold uppercase tracking-[.15em] text-foreground">{issue ? pausedGenerationContent.badge : generationPhases[activeIndex].label}</Badge>
      </Card>

      <div>
        <p className="mb-3.5 font-label text-[.72rem] font-extrabold uppercase tracking-[.22em] text-foreground">Creating {scene.name}</p>
        <h1 className="mb-6 max-w-[13ch] font-display text-[clamp(2.6rem,6vw,5rem)] font-semibold leading-[.92] tracking-[-.06em]" tabIndex={-1}>Creating your caricature.</h1>
        <p className="m-0 max-w-[38rem] text-[clamp(.95rem,1.5vw,1.12rem)] leading-[1.65] text-muted-foreground">We upload your photo, check it for prohibited content, and use it to create your postcard.</p>
        {issue && visibleIssueContent && (
          <Alert className="mt-6 flex max-w-[38rem] items-start gap-3 border-danger/40 bg-danger/10 text-danger">
            <AlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <AlertTitle ref={issueHeadingRef} tabIndex={-1}>{visibleIssueContent.title}</AlertTitle>
              <AlertDescription className="text-foreground/80"><p>{visibleIssueContent.message}</p></AlertDescription>
              <div className="mt-4 flex flex-wrap gap-3 max-[480px]:flex-col">
                {issue.kind === 'connection_lost' && (
                  <Button className="max-[480px]:w-full" type="button" onClick={checkGeneration}>{issueActionLabels.check}</Button>
                )}
                {issue.kind !== 'connection_lost' && !(issue.kind === 'terminal' && issue.code === 'photo_rejected') && (
                  <Button className="max-[480px]:w-full" type="button" onClick={retryGeneration}>{issueActionLabels.retry}</Button>
                )}
                <Button className="max-[480px]:w-full" variant={issue.kind === 'terminal' && issue.code === 'photo_rejected' ? 'default' : 'secondary'} type="button" onClick={onChooseAnotherPhoto}>{issueActionLabels.anotherPhoto}</Button>
              </div>
            </div>
          </Alert>
        )}
        <Progress className="mt-8" indicatorClassName="generation-progress-indicator" value={isComplete ? 100 : progress} aria-label="Generation progress" aria-valuetext={issue ? pausedGenerationContent.progress : undefined} />
        <ol className="mt-8 flex list-none flex-col gap-2 m-0 p-0">
          {generationPhases.map(({ id, label }, index) => {
            const completed = isComplete || index < activeIndex;
            const active = !isComplete && !issue && index === activeIndex;
            return (
              <li
                className={`flex items-center gap-3 border-b border-border py-3 text-muted-foreground transition-colors ${active ? 'font-bold text-foreground' : completed ? 'text-success' : ''}`}
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
