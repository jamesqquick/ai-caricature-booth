import { ArrowRight, Check } from 'lucide-react';
import type { PublicScene } from '../../data/scenes';
import { Button } from '../ui/button';

type Props = {
  scenes: PublicScene[];
  selectedSceneId: string | null;
  onSelect: (sceneId: string) => void;
  onContinue: () => void;
  heading: string;
};

export function SceneStep({ scenes, selectedSceneId, onSelect, onContinue, heading }: Props) {
  return (
    <div className="step-enter w-full max-w-[74rem]">
      <div className="mb-[clamp(1.5rem,3vw,2.75rem)]">
        <div>
          <h1 className="m-0 max-w-full font-display text-[clamp(2.75rem,7vw,6.5rem)] font-semibold leading-[.92] tracking-[-.06em]" tabIndex={-1}>{heading}</h1>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 max-[800px]:grid-cols-2 max-[520px]:grid-cols-1" role="group" aria-label="Choose a scene">
        {scenes.map((scene) => {
          const selected = scene.id === selectedSceneId;

          return (
            <Button
              variant="unstyled"
              size="unstyled"
              className="scene-card-visual relative grid min-h-[9.5rem] grid-cols-[auto_1fr] grid-rows-[auto_1fr] items-stretch justify-stretch gap-x-4 gap-y-3.5 overflow-hidden whitespace-normal rounded-[1.1rem] border border-border p-4 text-left font-normal text-foreground"
              data-selected={selected}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(scene.id)}
              key={scene.id}
            >
              <span className="scene-number font-label text-[.65rem]">0{scenes.indexOf(scene) + 1}</span>
              <span className="col-span-1 row-start-2 flex flex-col gap-1 self-end">
                <strong className="text-[1.02rem]">{scene.name}</strong>
                <small className="max-w-[28ch] text-[.76rem] leading-[1.4]">{scene.description}</small>
              </span>
              <span className={`scene-check pointer-events-none absolute right-3 top-3 grid size-6 place-items-center rounded-full border border-current bg-primary text-[.7rem] font-black text-primary-foreground opacity-0 transition-[opacity,transform] duration-150 ${selected ? 'scale-100 opacity-100' : 'scale-75'}`} aria-hidden="true">
                <Check size={13} strokeWidth={3} />
              </span>
            </Button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 max-[520px]:flex-col max-[520px]:items-stretch">

        <Button type="button" size="lg" disabled={!selectedSceneId} onClick={onContinue}>
          Take selfie <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
