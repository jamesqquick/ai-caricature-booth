/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_FAILURE_CODES, generationFailureContent } from '../src/lib/generation-errors';

const actionMocks = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  getGeneration: vi.fn(),
}));

import { GeneratingStep } from '../src/components/steps/GeneratingStep';

const scene = {
  id: 'subway',
  name: 'Subway Platform',
  description: 'A bustling subway platform',
};
const photoDataUrl = 'data:image/jpeg;base64,cGhvdG8=';
const firstIdempotencyKey = '00000000-0000-4000-8000-000000000001';
const secondIdempotencyKey = '00000000-0000-4000-8000-000000000002';

function startResult(sessionId = firstIdempotencyKey) {
  return {
    data: { sessionId, status: 'uploading' },
    error: undefined,
  };
}

function statusResult(status: 'uploading' | 'completed' | 'errored', failureCode: unknown = null) {
  return {
    data: { status, failureCode, postcardUrl: null },
    error: undefined,
  };
}

function renderGenerating(overrides: Partial<React.ComponentProps<typeof GeneratingStep>> = {}) {
  return render(
    <GeneratingStep
      scene={scene}
      photoDataUrl={photoDataUrl}
      eventSlug="demo-event"
      onComplete={vi.fn()}
      onChooseAnotherPhoto={vi.fn()}
      generationActions={actionMocks}
      {...overrides}
    />,
  );
}

async function showConnectionIssue(overrides: Partial<React.ComponentProps<typeof GeneratingStep>> = {}) {
  actionMocks.startGeneration.mockResolvedValue(startResult());
  actionMocks.getGeneration.mockRejectedValue(new Error('POLL_SENTINEL: raw response and validation dump'));
  renderGenerating(overrides);

  await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledTimes(1));
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  await screen.findByRole('alert');
}

describe('GeneratingStep error recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    actionMocks.startGeneration.mockReset();
    actionMocks.getGeneration.mockReset();
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(firstIdempotencyKey)
      .mockReturnValueOnce(secondIdempotencyKey);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' })),
    }));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(GENERATION_FAILURE_CODES)('renders fixed recovery copy for persisted code %s', async (failureCode) => {
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockResolvedValue(statusResult('errored', failureCode));

    renderGenerating();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(generationFailureContent[failureCode].message);
  });

  it.each([null, undefined, '', 'invalid_failure', { validation: 'dump' }])(
    'falls back to unknown failure copy for invalid code %s',
    async (failureCode) => {
      actionMocks.startGeneration.mockResolvedValue(startResult());
      actionMocks.getGeneration.mockResolvedValue(statusResult('errored', failureCode));

      renderGenerating();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(generationFailureContent.unknown_failure.message);
      expect(alert.textContent).not.toContain('invalid_failure');
      expect(alert.textContent).not.toContain('validation');
    },
  );

  it('never renders arbitrary start action failure details', async () => {
    actionMocks.startGeneration.mockResolvedValue({
      data: undefined,
      error: { message: 'START_SENTINEL: raw response and validation dump' },
    });

    renderGenerating();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("We couldn't start your postcard.");
    expect(alert.textContent).not.toContain('START_SENTINEL');
    expect(alert.textContent).not.toContain('validation dump');
  });

  it('never renders a thrown start failure message', async () => {
    actionMocks.startGeneration.mockRejectedValue(new Error('THROWN_START_SENTINEL: provider details'));

    renderGenerating();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("We couldn't start your postcard.");
    expect(alert.textContent).not.toContain('THROWN_START_SENTINEL');
    expect(alert.textContent).not.toContain('provider details');
  });

  it('shows connection recovery after three failed polls without disclosing thrown details', async () => {
    await showConnectionIssue();

    const alert = screen.getByRole('alert');
    expect(actionMocks.getGeneration).toHaveBeenCalledTimes(3);
    expect(alert.textContent).toContain('Your postcard may still be processing.');
    expect(alert.textContent).not.toContain('POLL_SENTINEL');
    expect(document.querySelector('.ink-scan')).toBeNull();
    expect(screen.queryByRole('listitem', { current: 'step' })).toBeNull();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Paused for recovery');
  });

  it('checks the existing session after a connection loss without starting or uploading again', async () => {
    const onComplete = vi.fn();
    await showConnectionIssue({ onComplete });
    actionMocks.getGeneration.mockReset();
    actionMocks.getGeneration.mockResolvedValue(statusResult('completed'));
    vi.mocked(fetch).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledWith({ sessionId: firstIdempotencyKey }));

    expect(actionMocks.startGeneration).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(onComplete).toHaveBeenCalledWith(firstIdempotencyKey);
  });

  it('starts only one replacement poll loop after rapid repeated checks', async () => {
    await showConnectionIssue();
    actionMocks.getGeneration.mockReset();
    actionMocks.getGeneration.mockImplementation(() => new Promise(() => {}));
    const checkAgain = screen.getByRole('button', { name: 'Check again' });

    act(() => {
      checkAgain.click();
      checkAgain.click();
    });

    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledTimes(1));
    expect(actionMocks.getGeneration).toHaveBeenCalledWith({ sessionId: firstIdempotencyKey });
  });

  it('retries a terminal failure with a fresh key and the same photo and scene', async () => {
    const onComplete = vi.fn();
    actionMocks.startGeneration
      .mockResolvedValueOnce(startResult(firstIdempotencyKey))
      .mockResolvedValueOnce(startResult(secondIdempotencyKey));
    actionMocks.getGeneration
      .mockResolvedValueOnce(statusResult('errored', 'generation_failed'))
      .mockResolvedValueOnce(statusResult('completed'));

    renderGenerating({ onComplete });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(actionMocks.startGeneration).toHaveBeenCalledTimes(2));
    const firstForm = actionMocks.startGeneration.mock.calls[0][0] as FormData;
    const secondForm = actionMocks.startGeneration.mock.calls[1][0] as FormData;
    expect(firstForm.get('idempotencyKey')).toBe(firstIdempotencyKey);
    expect(secondForm.get('idempotencyKey')).toBe(secondIdempotencyKey);
    expect(firstForm.get('sceneId')).toBe(scene.id);
    expect(secondForm.get('sceneId')).toBe(scene.id);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([photoDataUrl, photoDataUrl]);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(onComplete).toHaveBeenCalledWith(secondIdempotencyKey);
  });

  it('reuses the same key when retrying an ambiguous start failure', async () => {
    actionMocks.startGeneration
      .mockResolvedValueOnce({ data: undefined, error: { message: 'START_SENTINEL' } })
      .mockResolvedValueOnce(startResult(firstIdempotencyKey));
    actionMocks.getGeneration.mockResolvedValue(statusResult('completed'));

    renderGenerating();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(actionMocks.startGeneration).toHaveBeenCalledTimes(2));
    const keys = actionMocks.startGeneration.mock.calls.map(([form]) => (form as FormData).get('idempotencyKey'));
    expect(keys).toEqual([firstIdempotencyKey, firstIdempotencyKey]);
  });

  it('only offers another photo after photo rejection', async () => {
    const onChooseAnotherPhoto = vi.fn();
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockResolvedValue(statusResult('errored', 'photo_rejected'));

    renderGenerating({ onChooseAnotherPhoto });
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another photo' }));
    expect(onChooseAnotherPhoto).toHaveBeenCalledOnce();
  });

  it('moves focus to the alert heading when a failure appears', async () => {
    actionMocks.startGeneration.mockResolvedValue({ data: undefined, error: { message: 'START_SENTINEL' } });

    renderGenerating();

    const heading = await screen.findByRole('heading', { name: "We couldn't start your postcard." });
    expect(document.activeElement).toBe(heading);
  });

  it('keeps normal completion behavior unchanged', async () => {
    const onComplete = vi.fn();
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockResolvedValue(statusResult('completed'));

    renderGenerating({ onComplete });
    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledOnce());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(onComplete).toHaveBeenCalledWith(firstIdempotencyKey);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a stale poll response after unmount', async () => {
    const onComplete = vi.fn();
    let resolvePoll!: (value: ReturnType<typeof statusResult>) => void;
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockReturnValue(new Promise((resolve) => {
      resolvePoll = resolve;
    }));
    const { unmount } = renderGenerating({ onComplete });
    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledOnce());

    unmount();
    await act(async () => {
      resolvePoll(statusResult('completed'));
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('cancels active progress animation when recovery appears', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    actionMocks.startGeneration.mockResolvedValue({ data: undefined, error: { message: 'START_SENTINEL' } });

    renderGenerating();
    await screen.findByRole('alert');

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  it('does not schedule progress animation frames when reduced motion is preferred', async () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockResolvedValue(statusResult('uploading'));

    renderGenerating();
    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledOnce());

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });
});
