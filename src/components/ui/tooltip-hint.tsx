import { CircleHelp } from 'lucide-react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

type TooltipHintProps = {
  label: string;
  text: string;
};

export function TooltipHint({ label, text }: TooltipHintProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`About ${label}`}
          >
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-center leading-5">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
