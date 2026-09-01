import { useEffect, useReducer, useRef, type CSSProperties } from 'react';
import type { PublicScene } from '../data/scenes';
import { boothReducer, createInitialBoothState, type BoothStep } from '../lib/booth-machine';
import { eventAccentForeground } from '../lib/event-accent';
import { Stepper } from './Stepper';
import { CameraStep } from './steps/CameraStep';
import { GeneratingStep } from './steps/GeneratingStep';
import { SceneStep } from './steps/SceneStep';

const stepLabels: Array<{ id: BoothStep; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'camera', label: 'Photo' },
  { id: 'generating', label: 'Create' },
];

type Props = {
  eventName: string;
  eventSlug: string;
  tagline: string;
  kioskIdleSubhead: string;
  scenePickerHeading: string;
  accentColor: string;
  scenes: PublicScene[];
};

export function Photobooth({ eventName, eventSlug, tagline, kioskIdleSubhead, scenePickerHeading, accentColor, scenes }: Props) {
  const [state, dispatch] = useReducer(boothReducer, scenes[0]?.id ?? null, createInitialBoothState);
  const stageRef = useRef<HTMLElement>(null);
  const previousStepRef = useRef(state.step);
  const activeIndex = stepLabels.findIndex((step) => step.id === state.step);
  const selectedScene = scenes.find((scene) => scene.id === state.sceneId) ?? null;
  const accentForeground = eventAccentForeground(accentColor);
  const finishGeneration = (sessionId: string) => window.location.assign(`/p/${sessionId}?source=generation`);

  useEffect(() => {
    if (previousStepRef.current === state.step) return;
    previousStepRef.current = state.step;
    stageRef.current?.querySelector<HTMLElement>('h1, [data-step-focus]')?.focus();
  }, [state.step]);

  return (
    <main className="booth-event relative isolate grid min-h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-[radial-gradient(circle_at_15%_12%,color-mix(in_oklch,var(--event-accent)_12%,transparent),transparent_27rem),radial-gradient(circle_at_88%_84%,oklch(65%_0.13_300_/_0.08),transparent_30rem),var(--ink)] max-[800px]:overflow-auto" style={{ '--event-accent': accentColor, '--event-accent-foreground': accentForeground } as CSSProperties}>
      <div className="ambient-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.16]" aria-hidden="true" />
      <Stepper
        steps={stepLabels}
        activeIndex={activeIndex}
        onSceneClick={state.step === 'scene' ? undefined : () => dispatch({ type: 'change-scene' })}
      />

      <section className="grid min-h-0 items-start justify-items-center px-[clamp(1.5rem,4vw,4rem)] pb-[clamp(1.5rem,4vw,4rem)] pt-[clamp(4rem,10vh,8rem)] max-[800px]:px-4 max-[800px]:pb-8 max-[800px]:pt-2" aria-live="polite" ref={stageRef}>
        {state.step === 'scene' && (
          <SceneStep
            scenes={scenes}
            selectedSceneId={state.sceneId}
            tagline={tagline}
            heading={scenePickerHeading}
            onSelect={(sceneId) => dispatch({ type: 'select-scene', sceneId })}
            onContinue={() => dispatch({ type: 'open-camera' })}
          />
        )}
        {state.step === 'camera' && selectedScene && (
          <CameraStep
            onUsePhoto={(photoDataUrl) => dispatch({ type: 'accept-photo', photoDataUrl })}
          />
        )}
        {state.step === 'generating' && selectedScene && state.photoDataUrl && (
          <GeneratingStep
            scene={selectedScene}
            photoDataUrl={state.photoDataUrl}
            eventSlug={eventSlug}
            onComplete={finishGeneration}
          />
        )}
      </section>

      <footer className="flex justify-between gap-4 border-t border-border px-[clamp(1.25rem,4vw,4rem)] py-3.5 pb-[max(.85rem,env(safe-area-inset-bottom))] text-[.62rem] font-bold uppercase tracking-[.12em] text-muted-foreground max-[520px]:flex-col max-[520px]:items-start">
        <span>{eventName}</span>
        <span>{kioskIdleSubhead}</span>
      </footer>
    </main>
  );
}
