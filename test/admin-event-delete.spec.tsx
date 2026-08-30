/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDeleteControl } from '../src/components/admin/EventDeleteControl';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('event deletion', () => {
  it('uses the reusable dialog and restores focus when cancelled', () => {
    render(<EventDeleteControl eventName="Demo Event" endpoint="/api/admin/events/demo-event" />);

    const trigger = screen.getByRole('button', { name: 'Delete event' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Delete Demo Event' });
    expect(within(dialog).getByText(/sessions, scenes, and stored images/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the dialog open and reports delete failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Couldn't delete the event." }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )));
    render(<EventDeleteControl eventName="Demo Event" endpoint="/api/admin/events/demo-event" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Permanently delete event' }));
    });

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe("Couldn't delete the event."));
    expect(fetch).toHaveBeenCalledWith('/api/admin/events/demo-event', { method: 'DELETE' });
  });

});
