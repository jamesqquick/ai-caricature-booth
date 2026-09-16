/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCENE_DELETED_EVENT,
  SCENE_DELETE_REQUEST_EVENT,
  SceneDeleteDialog,
} from '../src/components/admin/SceneDeleteDialog';

const dispose: Array<() => void> = [];

afterEach(() => {
  dispose.splice(0).forEach((callback) => callback());
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('scene deletion dialog', () => {
  it('confirms deletion, calls the endpoint, and announces the deleted scene', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: true, sceneId: 'first' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const deleted = vi.fn();
    window.addEventListener(SCENE_DELETED_EVENT, deleted);
    dispose.push(() => window.removeEventListener(SCENE_DELETED_EVENT, deleted));
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    dispose.push(() => trigger.remove());
    render(<SceneDeleteDialog />);

    act(() => window.dispatchEvent(new CustomEvent(SCENE_DELETE_REQUEST_EVENT, {
      detail: {
        endpoint: '/api/admin/events/demo/scenes/first',
        sceneId: 'first',
        sceneName: 'First Scene',
        trigger,
      },
    })));

    const dialog = screen.getByRole('dialog', { name: 'Delete First Scene' });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Permanently delete scene' }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetch).toHaveBeenCalledWith('/api/admin/events/demo/scenes/first', { method: 'DELETE' });
    expect(deleted).toHaveBeenCalledWith(expect.objectContaining({ detail: { sceneId: 'first' } }));
  });

  it('keeps the dialog open and displays API failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Active events must have at least one scene.' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )));
    render(<SceneDeleteDialog />);

    act(() => window.dispatchEvent(new CustomEvent(SCENE_DELETE_REQUEST_EVENT, {
      detail: {
        endpoint: '/api/admin/events/demo/scenes/first',
        sceneId: 'first',
        sceneName: 'First Scene',
        trigger: document.createElement('button'),
      },
    })));

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Permanently delete scene' }));
    });

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent)
      .toBe('Active events must have at least one scene.'));
  });
});
