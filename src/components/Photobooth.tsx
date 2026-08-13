import { useEffect, useReducer, useRef } from 'react';
import { Check, Cloud } from 'lucide-react';
import { scenes } from '../data/scenes';
import { boothReducer, initialBoothState, type BoothStep } from '../lib/booth-machine';
import { Badge } from './ui/badge';
import { CameraStep } from './steps/CameraStep';
import { GeneratingStep } from './steps/GeneratingStep';
import { ReviewStep } from './steps/ReviewStep';
import { SceneStep } from './steps/SceneStep';

const stepLabels: Array<{ id: BoothStep; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'camera', label: 'Photo' },
  { id: 'generating', label: 'Create' },
  { id: 'review', label: 'Review' },
];

export function Photobooth() {
  const [state, dispatch] = useReducer(boothReducer, initialBoothState);
  const stageRef = useRef<HTMLElement>(null);
  const previousStepRef = useRef(state.step);
  const activeIndex = stepLabels.findIndex((step) => step.id === state.step);
  const selectedScene = scenes.find((scene) => scene.id === state.sceneId) ?? null;

  useEffect(() => {
    if (previousStepRef.current === state.step) return;
    previousStepRef.current = state.step;
    stageRef.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [state.step]);

  return (
    <main className="relative isolate grid min-h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-[radial-gradient(circle_at_15%_12%,oklch(72%_0.19_52_/_0.12),transparent_27rem),radial-gradient(circle_at_88%_84%,oklch(65%_0.13_300_/_0.08),transparent_30rem),var(--ink)] max-[800px]:overflow-auto">
      <div className="ambient-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.16]" aria-hidden="true" />
      <header className="flex w-full items-center justify-between gap-8 border-b border-border px-[clamp(1.25rem,4vw,4rem)] pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] max-[800px]:flex-col max-[800px]:items-start max-[800px]:gap-3.5">
        <a className="inline-flex items-center gap-2.5 whitespace-nowrap font-display text-xs font-extrabold uppercase tracking-[0.09em] text-foreground no-underline" href="/" aria-label="NYC Caricature Booth home">
          <span className="grid size-10 place-items-center rotate-[-5deg] rounded-full bg-primary text-primary-foreground" aria-hidden="true"><Cloud size={17} strokeWidth={2.4} /></span>
          <span>Caricature Booth</span>
        </a>
        <ol className="flex items-center gap-[clamp(.5rem,2vw,1.4rem)] m-0 list-none p-0 max-[800px]:w-full max-[800px]:justify-between" aria-label="Booth progress">
          {stepLabels.map((step, index) => (
            <li
              className={`relative flex items-center gap-2 text-muted-foreground max-[800px]:flex-1 ${index === activeIndex ? 'text-primary' : index < activeIndex ? 'text-success' : ''} ${index < stepLabels.length - 1 ? 'after:ml-[clamp(.1rem,1vw,.8rem)] after:h-px after:w-[clamp(.8rem,2.5vw,2.6rem)] after:bg-current max-[800px]:after:flex-1' : ''}`}
              key={step.id}
              aria-current={index === activeIndex ? 'step' : undefined}
              aria-label={`${step.label}, ${index === activeIndex ? 'current step' : index < activeIndex ? 'completed' : 'upcoming'}`}
            >
              <span className={`grid size-7 place-items-center rounded-full border border-current text-[.65rem] font-extrabold ${index === activeIndex ? 'bg-primary text-primary-foreground' : ''}`}>{index < activeIndex ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : index + 1}</span>
              <small className="text-[.65rem] font-bold uppercase tracking-[.12em] max-[800px]:hidden">{step.label}</small>
            </li>
          ))}
        </ol>
      </header>

      <section className="grid min-h-0 place-items-center p-[clamp(1.5rem,4vw,4rem)] max-[800px]:items-start max-[800px]:px-4 max-[800px]:pb-8 max-[800px]:pt-6" aria-live="polite" ref={stageRef}>
        {state.step === 'scene' && (
          <SceneStep
            scenes={scenes}
            selectedSceneId={state.sceneId}
            onSelect={(sceneId) => dispatch({ type: 'select-scene', sceneId })}
            onContinue={() => dispatch({ type: 'open-camera' })}
          />
        )}
        {state.step === 'camera' && selectedScene && (
          <CameraStep
            scene={selectedScene}
            onBack={() => dispatch({ type: 'change-scene' })}
            onUsePhoto={(photoDataUrl) => dispatch({ type: 'accept-photo', photoDataUrl })}
          />
        )}
        {state.step === 'generating' && selectedScene && state.photoDataUrl && (
          <GeneratingStep
            scene={selectedScene}
            photoDataUrl={state.photoDataUrl}
            onComplete={() => dispatch({ type: 'finish-generation' })}
          />
        )}
        {state.step === 'review' && selectedScene && state.photoDataUrl && (
          <ReviewStep
            scene={selectedScene}
            photoDataUrl={state.photoDataUrl}
            onRetake={() => dispatch({ type: 'retake' })}
            onChangeScene={() => dispatch({ type: 'change-scene' })}
            onStartOver={() => dispatch({ type: 'start-over' })}
          />
        )}
      </section>

      <footer className="flex justify-between gap-4 border-t border-border px-[clamp(1.25rem,4vw,4rem)] py-3.5 pb-[max(.85rem,env(safe-area-inset-bottom))] text-[.62rem] font-bold uppercase tracking-[.12em] text-muted-foreground max-[520px]:flex-col max-[520px]:items-start">
        <span>NYC Tech Week 2026</span>
        <Badge variant="outline">Private · On device</Badge>
      </footer>
    </main>
  );
}
