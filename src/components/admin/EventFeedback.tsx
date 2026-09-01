import { useEffect } from 'react';
import { toast } from 'sonner';
import { eventFeedbackMessages, type EventFeedbackCode } from '../../lib/admin-event-feedback';

type Props = {
  saved: boolean;
  feedbackCode: EventFeedbackCode | null;
};

export function EventFeedback({ saved, feedbackCode }: Props) {
  useEffect(() => {
    if (saved) toast.success('Event saved.');
    if (feedbackCode && Object.hasOwn(eventFeedbackMessages, feedbackCode)) {
      toast.error(eventFeedbackMessages[feedbackCode]);
    }
  }, [saved, feedbackCode]);

  return null;
}
