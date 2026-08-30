import { useEffect } from 'react';
import { toast } from 'sonner';

type Props = {
  saved: boolean;
  errorMessage: string | null;
};

export function EventFeedback({ saved, errorMessage }: Props) {
  useEffect(() => {
    if (saved) toast.success('Event saved.');
    if (errorMessage) toast.error(errorMessage);
  }, [saved, errorMessage]);

  return null;
}
