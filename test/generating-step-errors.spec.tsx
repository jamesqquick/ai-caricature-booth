/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_FAILURE_CODES, generationFailureContent } from '../src/lib/generation-errors';
import type { GenerationStatus } from '../src/lib/generation-progress';

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
const actionTimeoutMs = 15_000;

function astroActionError(code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONTENT_TOO_LARGE', message: string) {
  return {
    type: 'AstroActionError',
    code,
    status: code === 'BAD_REQUEST' ? 400 : code === 'NOT_FOUND' ? 404 : 413,
    message,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function startResult(sessionId = firstIdempotencyKey) {
  return {
    data: { sessionId, status: 'uploading' },
    error: undefined,
  };
}

function statusResult(status: GenerationStatus, failureCode: unknown = null) {
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

async function showConnectionIssueAfterKnownPhase(overrides: Partial<React.ComponentProps<typeof GeneratingStep>> = {}) {
  actionMocks.startGeneration.mockResolvedValue(startResult());
  actionMocks.getGeneration
    .mockResolvedValueOnce(statusResult('generating'))
    .mockRejectedValue(new Error('POLL_SENTINEL: raw response and validation dump'));
  renderGenerating(overrides);

  await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledTimes(1));
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
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

  it.each([
    ['BAD_REQUEST', 'BAD_REQUEST_SECRET: invalid session details'],
    ['NOT_FOUND', 'NOT_FOUND_SECRET: missing booth details'],
    ['CONTENT_TOO_LARGE', 'CONTENT_TOO_LARGE_SECRET: request body details'],
  ] as const)('treats Astro %s start errors as permanent without disclosing details', async (code, sentinel) => {
    actionMocks.startGeneration.mockResolvedValue({
      data: undefined,
      error: astroActionError(code, sentinel),
    });

    renderGenerating();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("This photo request can't continue.");
    expect(alert.textContent).toContain('Choose another photo to start a fresh request.');
    expect(alert.textContent).not.toContain(sentinel);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose another photo' })).toBeTruthy();
  });

  it.each([
    ['BAD_REQUEST', 'BAD_REQUEST_POLL_SECRET: invalid session details'],
    ['NOT_FOUND', 'NOT_FOUND_POLL_SECRET: missing session details'],
    ['CONTENT_TOO_LARGE', 'CONTENT_TOO_LARGE_POLL_SECRET: request body details'],
  ] as const)('treats Astro %s poll errors as permanent without disclosing details', async (code, sentinel) => {
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockResolvedValue({
      data: undefined,
      error: astroActionError(code, sentinel),
    });

    renderGenerating();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("This photo request can't continue.");
    expect(alert.textContent).toContain('Choose another photo to start a fresh request.');
    expect(alert.textContent).not.toContain(sentinel);
    expect(actionMocks.getGeneration).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose another photo' })).toBeTruthy();
  });

  it('times out a never-resolving start and retries with the same key', async () => {
    actionMocks.startGeneration.mockImplementation(() => new Promise(() => {}));

    renderGenerating();
    await waitFor(() => expect(actionMocks.startGeneration).toHaveBeenCalledOnce());
    await act(async () => vi.advanceTimersByTimeAsync(actionTimeoutMs));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(actionMocks.startGeneration).toHaveBeenCalledTimes(2));
    const keys = actionMocks.startGeneration.mock.calls.map(([form]) => (form as FormData).get('idempotencyKey'));
    expect(keys).toEqual([firstIdempotencyKey, firstIdempotencyKey]);
  });

  it('ignores a start result that settles after its timeout', async () => {
    const lateStart = deferred<ReturnType<typeof startResult>>();
    actionMocks.startGeneration.mockReturnValue(lateStart.promise);

    renderGenerating();
    await waitFor(() => expect(actionMocks.startGeneration).toHaveBeenCalledOnce());
    await act(async () => vi.advanceTimersByTimeAsync(actionTimeoutMs));
    const alert = await screen.findByRole('alert');

    await act(async () => lateStart.resolve(startResult()));

    expect(screen.getByRole('alert')).toBe(alert);
    expect(actionMocks.getGeneration).not.toHaveBeenCalled();
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

  it('counts three never-resolving polls as consecutive failures', async () => {
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration.mockImplementation(() => new Promise(() => {}));
    renderGenerating();

    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledOnce());
    await act(async () => vi.advanceTimersByTimeAsync((actionTimeoutMs * 3) + 3_000));

    await screen.findByRole('alert');
    expect(actionMocks.getGeneration).toHaveBeenCalledTimes(3);
    expect(screen.getByText('We lost the connection.')).toBeTruthy();
  });

  it('ignores a poll result that settles after its timeout', async () => {
    const latePoll = deferred<ReturnType<typeof statusResult>>();
    const onComplete = vi.fn();
    actionMocks.startGeneration.mockResolvedValue(startResult());
    actionMocks.getGeneration
      .mockReturnValueOnce(latePoll.promise)
      .mockRejectedValue(new Error('POLL_SENTINEL'));
    renderGenerating({ onComplete });

    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledOnce());
    await act(async () => vi.advanceTimersByTimeAsync(actionTimeoutMs + 3_000));
    const alert = await screen.findByRole('alert');

    await act(async () => latePoll.resolve(statusResult('completed')));

    expect(screen.getByRole('alert')).toBe(alert);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('checks the existing session without resetting progress or uploading again', async () => {
    const onComplete = vi.fn();
    const checkedStatus = deferred<ReturnType<typeof statusResult>>();
    await showConnectionIssueAfterKnownPhase({ onComplete });
    const progress = screen.getByRole('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('72');
    expect(screen.getByRole('listitem', { name: 'Creating your caricature, paused' })).toBeTruthy();
    actionMocks.getGeneration.mockReset();
    actionMocks.getGeneration.mockReturnValue(checkedStatus.promise);
    vi.mocked(fetch).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(actionMocks.getGeneration).toHaveBeenCalledWith({ sessionId: firstIdempotencyKey }));

    expect(actionMocks.startGeneration).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(progress.getAttribute('aria-valuenow')).toBe('72');
    expect(progress.getAttribute('aria-valuetext')).toBe('Checking status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Creating your caricature, checking status', current: 'step' })).toBeTruthy();
    expect(screen.getByText('Checking', { selector: 'span' })).toBeTruthy();
    const statusHeading = screen.getByRole('heading', { name: 'Checking status.' });
    await waitFor(() => expect(document.activeElement).toBe(statusHeading));
    await act(async () => checkedStatus.resolve(statusResult('completed')));
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

  it('starts only one replacement generation after rapid repeated retries', async () => {
    actionMocks.startGeneration
      .mockResolvedValueOnce(startResult())
      .mockImplementation(() => new Promise(() => {}));
    actionMocks.getGeneration.mockResolvedValueOnce(statusResult('errored', 'generation_failed'));

    renderGenerating();
    await screen.findByRole('alert');
    const tryAgain = screen.getByRole('button', { name: 'Try again' });

    act(() => {
      tryAgain.click();
      tryAgain.click();
    });

    await waitFor(() => expect(actionMocks.startGeneration).toHaveBeenCalledTimes(2));
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
    expect(screen.queryByRole('alert')).toBeNull();
    const statusHeading = screen.getByRole('heading', { name: 'Creating your caricature.' });
    await waitFor(() => expect(document.activeElement).toBe(statusHeading));
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
    await waitFor(() => expect(document.activeElement).toBe(heading));
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
    await waitFor(() => expect(cancelAnimationFrame).toHaveBeenCalledWith(42));
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
