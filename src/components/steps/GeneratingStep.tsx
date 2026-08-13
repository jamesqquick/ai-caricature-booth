import { useEffect, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import type { Scene } from '../../data/scenes';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';

type Props = {
  scene: Scene;
  photoDataUrl: string;
  onComplete: () => void;
};

const progressSteps = ['Reading your expression', 'Sketching bold ink lines', 'Framing the final postcard'];

export function GeneratingStep({ scene, photoDataUrl, onComplete }: Props) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setActiveStep(1), 900),
      window.setTimeout(() => setActiveStep(2), 1800),
      window.setTimeout(onComplete, 2900),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onComplete]);

  return (
    <div className="step-enter grid w-full max-w-[64rem] grid-cols-[minmax(17rem,28rem)_minmax(18rem,1fr)] items-center gap-[clamp(2rem,7vw,7rem)] max-[800px]:grid-cols-1 max-[800px]:mx-auto max-[800px]:max-w-md max-[800px]:gap-8">
      <div className="relative aspect-[4/5] w-full rotate-[-2deg] overflow-hidden rounded-[1.2rem] border border-border bg-card" style={{ '--scene-accent': scene.accent } as CSSProperties}>
        <img className="size-full object-cover grayscale-[.65] contrast-[1.15]" src={photoDataUrl} alt="Your photo being prepared" />
        <div className="ink-scan" aria-hidden="true" />
        <Badge className="absolute bottom-4 right-4 rotate-[-3deg] border-current bg-[oklch(15%_.018_55)] font-label text-[.58rem] font-extrabold uppercase tracking-[.15em] text-foreground">Demo render</Badge>
      </div>

      <div>
        <p className="mb-3.5 font-label text-[.72rem] font-extrabold uppercase tracking-[.22em] text-primary">Creating {scene.name}</p>
        <h1 className="mb-6 max-w-[13ch] font-display text-[clamp(2.6rem,6vw,5rem)] font-semibold leading-[.92] tracking-[-.06em]" tabIndex={-1}>Drawing outside the lines.</h1>
        <p className="m-0 max-w-[38rem] text-[clamp(.95rem,1.5vw,1.12rem)] leading-[1.65] text-muted-foreground">This prototype simulates the generation step locally. Nothing is uploaded.</p>
        <Progress className="mt-8" value={((activeStep + 1) / progressSteps.length) * 100} aria-label="Generation progress" />
        <ol className="mt-8 flex list-none flex-col gap-2 m-0 p-0">
          {progressSteps.map((label, index) => (
            <li
              className={`flex items-center gap-3 border-b border-border py-3 text-muted-foreground transition-colors ${index === activeStep ? 'text-primary' : index < activeStep ? 'text-success' : ''}`}
              aria-current={index === activeStep ? 'step' : undefined}
              aria-label={`${label}, ${index === activeStep ? 'in progress' : index < activeStep ? 'completed' : 'upcoming'}`}
              key={label}
            >
              <span className="grid size-6 place-items-center rounded-full border border-current text-[.63rem]">{index < activeStep ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : index + 1}</span>
              <strong>
                {label}
                {index === activeStep && <span className="sr-only"> (in progress)</span>}
              </strong>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
