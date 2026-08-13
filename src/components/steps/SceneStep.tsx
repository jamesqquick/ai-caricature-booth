import type { CSSProperties } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type { Scene } from '../../data/scenes';
import { Button } from '../ui/button';

type Props = {
  scenes: Scene[];
  selectedSceneId: string | null;
  onSelect: (sceneId: string) => void;
  onContinue: () => void;
};

export function SceneStep({ scenes, selectedSceneId, onSelect, onContinue }: Props) {
  return (
    <div className="step-enter w-full max-w-[74rem]">
      <div className="mb-[clamp(1.5rem,3vw,2.75rem)] grid grid-cols-[minmax(0,1fr)_minmax(16rem,31rem)] items-end gap-8 max-[800px]:grid-cols-1 max-[800px]:gap-4">
        <div>
          <p className="mb-3.5 font-label text-[.72rem] font-extrabold uppercase tracking-[.22em] text-primary">Step one</p>
          <h1 className="m-0 max-w-[13ch] font-display text-[clamp(2.75rem,7vw,6.5rem)] font-semibold leading-[.92] tracking-[-.06em]" tabIndex={-1}>Where should we draw you?</h1>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 max-[800px]:grid-cols-2 max-[520px]:grid-cols-1" role="group" aria-label="Choose a scene">
        {scenes.map((scene) => {
          const selected = scene.id === selectedSceneId;
          const style = {
            '--scene-accent': scene.accent,
            '--scene-backdrop': scene.backdrop,
          } as CSSProperties;

          return (
            <button
              className="scene-card-visual relative grid min-h-[9.5rem] grid-cols-[auto_1fr] grid-rows-[auto_1fr] gap-x-4 gap-y-3.5 overflow-hidden rounded-[1.1rem] border border-border p-4 text-left text-foreground"
              data-selected={selected}
              style={style}
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
              <span className={`scene-check pointer-events-none absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-[var(--scene-accent)] text-[.7rem] font-black text-[oklch(15%_.018_55)] opacity-0 transition-[opacity,transform] duration-150 ${selected ? 'scale-100 opacity-100' : 'scale-75'}`} aria-hidden="true">
                <Check size={13} strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 max-[520px]:flex-col max-[520px]:items-stretch">

        <Button type="button" size="lg" disabled={!selectedSceneId} onClick={onContinue}>
          Open camera <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
