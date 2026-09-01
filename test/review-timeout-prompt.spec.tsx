/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewTimeoutPrompt } from '../src/components/ReviewTimeoutPrompt';

describe('ReviewTimeoutPrompt', () => {
  const eventUrl = '/e/demo-event';
  let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    navigate = vi.fn<(url: string) => void>();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens after 15 seconds of inactivity and redirects after 30 seconds without a response', () => {
    render(<ReviewTimeoutPrompt eventUrl={eventUrl} navigate={navigate} />);

    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/30 seconds/)).toBeTruthy();

    act(() => vi.advanceTimersByTime(30_000));
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(eventUrl);
  });

  it('resets the 15-second inactivity timer on user activity', () => {
    render(<ReviewTimeoutPrompt eventUrl={eventUrl} navigate={navigate} />);

    act(() => vi.advanceTimersByTime(14_000));
    fireEvent.mouseMove(window);

    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('does not restart the timer after the user keeps reviewing', () => {
    render(<ReviewTimeoutPrompt eventUrl={eventUrl} navigate={navigate} />);

    act(() => vi.advanceTimersByTime(15_000));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, keep reviewing' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.mouseMove(window);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('returns to the event immediately when the user is done', () => {
    render(<ReviewTimeoutPrompt eventUrl={eventUrl} navigate={navigate} />);

    act(() => vi.advanceTimersByTime(15_000));
    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(eventUrl);
  });

  it('pauses timeout messaging and navigation while a print is active', () => {
    render(<ReviewTimeoutPrompt eventUrl={eventUrl} navigate={navigate} />);

    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    act(() => window.dispatchEvent(new CustomEvent('print-job-active', { detail: { active: true } })));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(navigate).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new CustomEvent('print-job-active', { detail: { active: false } })));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByText(/booth is ready for the next person/i)).toBeTruthy();
  });
});
