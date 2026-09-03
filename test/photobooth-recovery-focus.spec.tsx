/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:actions', () => ({ actions: {} }));

vi.mock('../src/components/steps/CameraStep', () => ({
  CameraStep: ({ onUsePhoto }: { onUsePhoto: (photoDataUrl: string) => void }) => (
    <div>
      <h1 data-step-focus tabIndex={-1}>Take your photo.</h1>
      <button type="button" onClick={() => onUsePhoto('data:image/jpeg;base64,cGhvdG8=')}>Use mock photo</button>
    </div>
  ),
}));

vi.mock('../src/components/steps/GeneratingStep', () => ({
  GeneratingStep: ({ scene, onChooseAnotherPhoto }: { scene: { name: string }; onChooseAnotherPhoto: () => void }) => (
    <div role="alert">
      <span>Failed for {scene.name}</span>
      <button type="button" onClick={onChooseAnotherPhoto}>Choose another photo</button>
    </div>
  ),
}));

import { Photobooth } from '../src/components/Photobooth';

const scenes = [
  { id: 'subway', name: 'Subway', description: 'A subway platform' },
  { id: 'rooftop', name: 'Rooftop', description: 'A rooftop at sunset' },
];

function renderPhotobooth() {
  return render(
    <Photobooth
      eventName="Demo event"
      eventSlug="demo-event"
      tagline="Pick a scene"
      kioskIdleSubhead="Ready when you are"
      scenePickerHeading="Choose your scene."
      accentColor="#ff5c35"
      scenes={scenes}
    />,
  );
}

describe('Photobooth recovery focus', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('focuses the camera and preserves its selected scene after recovery', async () => {
    renderPhotobooth();
    fireEvent.click(screen.getByRole('button', { name: /Rooftop/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use mock photo' }));
    expect(screen.getByRole('alert').textContent).toContain('Failed for Rooftop');

    fireEvent.click(screen.getByRole('button', { name: 'Choose another photo' }));

    expect(screen.queryByRole('alert')).toBeNull();
    const cameraFocusTarget = screen.getByRole('heading', { name: 'Take your photo.' });
    await waitFor(() => expect(document.activeElement).toBe(cameraFocusTarget));

    fireEvent.click(screen.getByRole('button', { name: 'Return to scene selection' }));
    expect(screen.getByRole('button', { name: /Rooftop/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('allows vertical scrolling at every viewport width', () => {
    const { container } = renderPhotobooth();
    const booth = container.querySelector('main');

    expect(booth?.classList.contains('overflow-y-auto')).toBe(true);
    expect(booth?.classList.contains('overflow-hidden')).toBe(false);
  });
});
