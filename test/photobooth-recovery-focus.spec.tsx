/** @vitest-environment jsdom */

import { useEffect, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraStep } from '../src/components/steps/CameraStep';
import { GeneratingStep, type GenerationActions } from '../src/components/steps/GeneratingStep';

const actionMocks: GenerationActions = {
  startGeneration: vi.fn(),
  getGeneration: vi.fn(),
};

function RecoveryHarness() {
  const [showCamera, setShowCamera] = useState(false);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (showCamera) stageRef.current?.querySelector<HTMLElement>('[data-step-focus]')?.focus();
  }, [showCamera]);

  return (
    <section ref={stageRef}>
      {showCamera ? (
        <CameraStep onUsePhoto={vi.fn()} />
      ) : (
        <GeneratingStep
          scene={{ id: 'subway', name: 'Subway', description: 'A subway platform' }}
          photoDataUrl="data:image/jpeg;base64,cGhvdG8="
          eventSlug="demo-event"
          onComplete={vi.fn()}
          onChooseAnotherPhoto={() => setShowCamera(true)}
          generationActions={actionMocks}
        />
      )}
    </section>
  );
}

describe('Photobooth recovery focus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(actionMocks.startGeneration).mockResolvedValue({
      data: { sessionId: '00000000-0000-4000-8000-000000000001', status: 'uploading' },
      error: undefined,
    });
    vi.mocked(actionMocks.getGeneration).mockResolvedValue({
      data: { status: 'errored', failureCode: 'photo_rejected', postcardUrl: null },
      error: undefined,
    });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' })),
    }));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('focuses the camera step after choosing another photo', async () => {
    render(<RecoveryHarness />);
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Choose another photo' }));

    expect(screen.queryByRole('alert')).toBeNull();
    const cameraFocusTarget = document.querySelector<HTMLElement>('[data-step-focus]');
    expect(cameraFocusTarget).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cameraFocusTarget));
  });
});
