/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDuplicateControl } from '../src/components/admin/EventDuplicateControl';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('event duplication control', () => {
  it('opens a full-viewport dialog with an editable copy name and restores focus', () => {
    render(<EventDuplicateControl eventName="Demo Event" endpoint="/api/admin/events/demo-event/duplicate" />);

    const trigger = screen.getByRole('button', { name: 'Duplicate event' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Duplicate Demo Event' });
    const name = within(dialog).getByRole('textbox', { name: 'Event name' });
    expect((name as HTMLInputElement).value).toBe('Demo Event (Copy)');
    expect(document.activeElement).toBe(name);
    expect(dialog.parentElement?.className).toContain('fixed inset-0');

    fireEvent.change(name, { target: { value: 'Regional Demo' } });
    expect((name as HTMLInputElement).value).toBe('Regional Demo');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('submits the edited name and redirects to the duplicate', async () => {
    const assign = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      redirectTo: '/admin/events/regional-demo',
    }), { status: 201, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('location', { assign });
    render(<EventDuplicateControl eventName="Demo Event" endpoint="/api/admin/events/demo-event/duplicate" />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate event' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Event name' }), {
      target: { value: 'Regional Demo' },
    });
    await act(async () => {
      fireEvent.submit(within(dialog).getByRole('form', { name: 'Duplicate event' }));
    });

    expect(fetch).toHaveBeenCalledWith('/api/admin/events/demo-event/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Regional Demo' }),
    });
    expect(assign).toHaveBeenCalledWith('/admin/events/regional-demo');
  });

  it('uses the latest name and slug after event details are saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      redirectTo: '/admin/events/updated-event-copy',
    }), { status: 201, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('location', { assign: vi.fn() });
    render(<EventDuplicateControl eventName="Demo Event" endpoint="/api/admin/events/demo-event/duplicate" />);

    act(() => {
      window.dispatchEvent(new CustomEvent('event-details-updated', {
        detail: { name: 'Updated Event', slug: 'updated-event' },
      }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate event' }));
    const dialog = screen.getByRole('dialog', { name: 'Duplicate Updated Event' });
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Event name' }).value).toBe('Updated Event (Copy)');
    await act(async () => {
      fireEvent.submit(within(dialog).getByRole('form', { name: 'Duplicate event' }));
    });

    expect(fetch).toHaveBeenCalledWith('/api/admin/events/updated-event/duplicate', expect.any(Object));
  });

  it('caps the suggested duplicate name at the event name limit', () => {
    render(<EventDuplicateControl eventName={'A'.repeat(120)} endpoint="/api/admin/events/long/duplicate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate event' }));

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Event name' }).value).toHaveLength(120);
  });

  it('keeps the dialog open and reports API failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Event details are invalid.',
      fields: { name: 'Enter an event name.' },
    }), { status: 400, headers: { 'content-type': 'application/json' } })));
    render(<EventDuplicateControl eventName="Demo Event" endpoint="/api/admin/events/demo-event/duplicate" />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate event' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: 'Event name' });
    fireEvent.change(name, { target: { value: '' } });
    await act(async () => {
      fireEvent.submit(within(dialog).getByRole('form', { name: 'Duplicate event' }));
    });

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('Enter an event name.'));
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });
});
