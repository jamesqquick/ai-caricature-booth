export const eventFeedbackMessages = {
  validation: 'Event details are invalid.',
  'slug-conflict': 'An event with that URL slug already exists.',
  activation: 'Add at least one scene before activating this event.',
  'save-failed': "Couldn't save the event.",
} as const;

export type EventFeedbackCode = keyof typeof eventFeedbackMessages;

export function parseEventFeedbackCode(value: string | null): EventFeedbackCode | null {
  return value && Object.hasOwn(eventFeedbackMessages, value)
    ? value as EventFeedbackCode
    : null;
}
