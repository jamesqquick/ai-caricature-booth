/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionDeleteControl } from '../src/components/admin/SessionDeleteControl';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('session deletion control', () => {
  it('uses an accessible destructive icon trigger and restores focus when cancelled', () => {
    const { container } = render(
      <SessionDeleteControl sessionId="session-123" endpoint="/api/admin/sessions/session-123" />,
    );

    const trigger = screen.getByRole('button', { name: 'Delete session session-123' });
    expect(trigger.className).toContain('border-destructive/50');
    expect(trigger.className).toContain('size-11');
    expect(trigger.textContent).toBe('');
    expect(container.querySelector('svg.lucide-trash-2')).toBeTruthy();

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Delete session' });
    expect(within(dialog).getByRole('heading', { name: 'Delete session' })).toBeTruthy();
    expect(within(dialog).getByText(/saved selfie, caricature, and postcard/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('disables confirmation controls while deletion is pending', async () => {
    let resolveDelete: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    })));
    render(<SessionDeleteControl sessionId="session-123" endpoint="/api/admin/sessions/session-123" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete session session-123' }));
    const dialog = screen.getByRole('dialog');
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete' });
    expect(deleteButton.querySelector('svg.lucide-trash-2')).toBeTruthy();
    fireEvent.click(deleteButton);

    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Deleting session...' }).disabled).toBe(true);
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);

    await act(async () => {
      resolveDelete?.(new Response(JSON.stringify({ error: 'Session changed in another request. Refresh and try again.' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }));
    });
  });

  it('keeps the dialog open and reports safe API failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Session changed in another request. Refresh and try again.' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )));
    render(<SessionDeleteControl sessionId="session-123" endpoint="/api/admin/sessions/session-123" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete session session-123' }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('Session changed in another request. Refresh and try again.'));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions/session-123', { method: 'DELETE' });
  });

  it('deletes the session and follows the API redirect', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: true, redirectTo: '/admin?status=completed' }),
      { headers: { 'content-type': 'application/json' } },
    )));
    render(<SessionDeleteControl sessionId="session-123" endpoint="/api/admin/sessions/session-123" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete session session-123' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });

    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions/session-123', { method: 'DELETE' });
    expect(assign).toHaveBeenCalledWith('/admin?status=completed');
  });

  it('prefers the explicit redirect override', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: true, redirectTo: '/admin' }),
      { headers: { 'content-type': 'application/json' } },
    )));
    render(
      <SessionDeleteControl
        sessionId="session-123"
        endpoint="/api/admin/sessions/session-123"
        redirectTo="/admin?eventId=7"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete session session-123' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });

    expect(assign).toHaveBeenCalledWith('/admin?eventId=7');
  });
});
