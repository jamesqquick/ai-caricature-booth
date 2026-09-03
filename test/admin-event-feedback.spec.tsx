/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { EventFeedback } from '../src/components/admin/EventFeedback';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('event feedback', () => {
  it('maps known feedback codes to fixed application copy', async () => {
    render(<EventFeedback saved={false} feedbackCode="activation" />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Add at least one scene before activating this event.'));
  });

  it('ignores arbitrary feedback values instead of rendering them', async () => {
    const sentinel = 'query-feedback-secret-sentinel-d41a8c';
    render(<EventFeedback saved={false} feedbackCode={sentinel as never} />);

    await waitFor(() => expect(toast.error).not.toHaveBeenCalled());
    expect(document.body.textContent).not.toContain(sentinel);
  });
});
