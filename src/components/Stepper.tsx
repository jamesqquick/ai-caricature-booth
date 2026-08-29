type Step = {
  id: string;
  label: string;
};

type StepperProps = {
  steps: Step[];
  activeIndex: number;
  onSceneClick?: () => void;
};

export function Stepper({ steps, activeIndex, onSceneClick }: StepperProps) {
  return (
    <div className="relative flex items-center justify-center px-[clamp(1.25rem,4vw,4rem)] pb-2 pt-8" role="group" aria-label="Booth progress">
      <ol className="m-0 flex list-none items-center gap-[clamp(.5rem,2vw,1.4rem)] p-0 max-[800px]:w-full max-[800px]:justify-between">
        {steps.map((step, index) => (
          <li
            className={`relative flex items-center gap-2 text-muted-foreground max-[800px]:flex-1 ${index === activeIndex || index < activeIndex ? 'font-bold text-foreground' : ''} ${index < steps.length - 1 ? 'after:ml-[clamp(.1rem,1vw,.8rem)] after:w-[clamp(.8rem,2.5vw,2.6rem)] after:border-t after:border-dashed after:border-current after:bg-transparent max-[800px]:after:flex-1' : ''}`}
            key={step.id}
            aria-current={index === activeIndex ? 'step' : undefined}
            aria-label={`${step.label}, ${index === activeIndex ? 'current step' : index < activeIndex ? 'completed' : 'upcoming'}`}
          >
            {step.id === 'scene' && onSceneClick ? (
              <button
                className="inline-flex items-center gap-2 bg-transparent p-0 text-inherit"
                type="button"
                onClick={onSceneClick}
                aria-label="Return to scene selection"
              >
                <span className={`grid size-7 place-items-center rounded-full border border-current text-[.65rem] font-extrabold ${index < activeIndex ? 'bg-primary text-primary-foreground' : index === activeIndex ? 'border-2 border-foreground text-foreground' : ''}`}>
                  {index + 1}
                </span>
                <small className="text-[.65rem] font-bold uppercase tracking-[.12em] max-[800px]:hidden">{step.label}</small>
              </button>
            ) : (
              <>
                <span className={`grid size-7 place-items-center rounded-full border border-current text-[.65rem] font-extrabold ${index < activeIndex ? 'bg-primary text-primary-foreground' : index === activeIndex ? 'border-2 border-foreground text-foreground' : ''}`}>
                  {index + 1}
                </span>
                <small className="text-[.65rem] font-bold uppercase tracking-[.12em] max-[800px]:hidden">{step.label}</small>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
