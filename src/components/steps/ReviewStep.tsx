import type { CSSProperties } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { Scene } from '../../data/scenes';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

type Props = {
  scene: Scene;
  photoDataUrl: string;
  postcardUrl: string | null;
  onRetake: () => void;
  onStartOver: () => void;
};

export function ReviewStep({ scene, photoDataUrl, postcardUrl, onRetake, onStartOver }: Props) {
  const style = {
    '--scene-accent': scene.accent,
    '--scene-backdrop': scene.backdrop,
  } as CSSProperties;

  return (
    <div className="step-enter grid w-full max-w-[64rem] grid-cols-[minmax(17rem,28rem)_minmax(18rem,1fr)] items-center gap-[clamp(2rem,7vw,7rem)] max-[800px]:grid-cols-1 max-[800px]:mx-auto max-[800px]:max-w-md max-[800px]:gap-8">
      <Card className="postcard-visual relative w-full rotate-[-1.5deg] rounded-[.45rem] p-[clamp(.7rem,2vw,1.1rem)] pb-0" style={style}>
        <div className="postcard-photo relative aspect-[4/5] overflow-hidden bg-card">
          <img className="size-full object-cover" src={postcardUrl ?? photoDataUrl} alt={`Your ${scene.name} postcard preview`} />
          <div className="postcard-hatch pointer-events-none absolute inset-0 opacity-[.22]" aria-hidden="true" />
        </div>
        <div className="grid min-h-[5.2rem] grid-cols-[auto_1fr_auto] items-center gap-3 py-3 px-1">
          <span className="text-3xl">{scene.emoji}</span>
          <div className="flex flex-col">
            <small className="font-label text-[.55rem] uppercase tracking-[.16em]">Greetings from</small>
            <strong className="font-display text-[clamp(1.1rem,3vw,1.65rem)]">{scene.name}</strong>
          </div>
          <b>NYC</b>
        </div>
        <span className="postcard-demo absolute right-4 top-6 rotate-[-3deg] border border-current px-2.5 py-1.5 font-label text-[.58rem] font-extrabold uppercase tracking-[.15em]">Preview</span>
      </Card>

      <div>
        <p className="mb-3.5 font-label text-[.72rem] font-extrabold uppercase tracking-[.22em] text-primary">Your postcard</p>
        <h1 className="mb-6 max-w-[13ch] font-display text-[clamp(2.6rem,6vw,5rem)] font-semibold leading-[.92] tracking-[-.06em]" tabIndex={-1}>That belongs on the fridge.</h1>
        <p className="m-0 max-w-[38rem] text-[clamp(.95rem,1.5vw,1.12rem)] leading-[1.65] text-muted-foreground">Your watermarked postcard is ready to review. It is served privately from the booth.</p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
          <Button type="button" onClick={onStartOver}><Check aria-hidden="true" /> Finish and start over</Button>
          <Button variant="secondary" type="button" onClick={onRetake}><RotateCcw aria-hidden="true" /> Retake photo</Button>
        </div>
      </div>
    </div>
  );
}
