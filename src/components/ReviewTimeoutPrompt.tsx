import { useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

const INACTIVITY_DELAY_MS = 15_000;
const RESPONSE_WINDOW_MS = 30_000;
const activityEvents = ['click', 'change', 'input', 'keydown', 'mousemove', 'scroll', 'touchstart'] as const;

type Props = {
  eventUrl: string;
  navigate?: (url: string) => void;
};

type PromptPhase = 'waiting' | 'prompting' | 'handled';

export function ReviewTimeoutPrompt({ eventUrl, navigate }: Props) {
  const [phase, setPhase] = useState<PromptPhase>('waiting');
  const [remainingSeconds, setRemainingSeconds] = useState(RESPONSE_WINDOW_MS / 1000);
  const [printActive, setPrintActive] = useState(false);
  const hasNavigatedRef = useRef(false);
  const hasHandledRef = useRef(false);
  const printActiveRef = useRef(false);

  const leaveReview = () => {
    if (hasNavigatedRef.current || printActiveRef.current) return;
    hasHandledRef.current = true;
    setPhase('handled');
    hasNavigatedRef.current = true;
    (navigate ?? ((url: string) => window.location.replace(url)))(eventUrl);
  };

  useEffect(() => {
    const handlePrintActivity = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
      printActiveRef.current = active;
      setPrintActive(active);
      if (active) setPhase('waiting');
    };
    window.addEventListener('print-job-active', handlePrintActivity);
    return () => window.removeEventListener('print-job-active', handlePrintActivity);
  }, []);

  useEffect(() => {
    if (phase !== 'waiting' || hasHandledRef.current || printActive) return;

    let timeout = window.setTimeout(() => setPhase('prompting'), INACTIVITY_DELAY_MS);
    const resetInactivityTimer = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setPhase('prompting'), INACTIVITY_DELAY_MS);
    };

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, resetInactivityTimer);
    }

    return () => {
      window.clearTimeout(timeout);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, resetInactivityTimer);
      }
    };
  }, [phase, printActive]);

  useEffect(() => {
    if (phase !== 'prompting' || printActive) return;

    const deadline = Date.now() + RESPONSE_WINDOW_MS;
    setRemainingSeconds(RESPONSE_WINDOW_MS / 1000);

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) leaveReview();
    };

    const interval = window.setInterval(updateRemaining, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [phase, printActive]);

  const keepReviewing = () => {
    hasHandledRef.current = true;
    setPhase('handled');
  };

  return (
    <AlertDialog
      open={phase === 'prompting'}
      onOpenChange={(open) => {
        if (open && !hasHandledRef.current) setPhase('prompting');
      }}
    >
      <AlertDialogContent aria-describedby="review-timeout-description">
        <AlertDialogHeader>
          <p className="m-0 font-label text-[.68rem] font-bold uppercase tracking-[.2em] text-primary">Review check</p>
          <AlertDialogTitle>Are you still reviewing?</AlertDialogTitle>
          <AlertDialogDescription id="review-timeout-description">
            This booth is ready for the next person. Choose an option within {remainingSeconds} seconds or you&apos;ll be returned to the event page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={leaveReview}>I&apos;m done</AlertDialogCancel>
          <AlertDialogAction onClick={keepReviewing}>Yes, keep reviewing</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
