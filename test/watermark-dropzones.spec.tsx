/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WATERMARK_FILE_SELECTED_EVENT,
  WATERMARK_UPLOAD_STATE_EVENT,
} from '../src/lib/admin-watermark-dropzone';
import { WatermarkDropzones } from '../src/components/admin/WatermarkDropzones';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function dropData(file: File) {
  return {
    dataTransfer: {
      files: [file],
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      types: ['Files'],
    },
  };
}

describe('WatermarkDropzones', () => {
  it('renders separate accessible targets for both watermark sides', () => {
    render(<WatermarkDropzones leftHasWatermark={false} rightHasWatermark={false} />);

    expect(screen.getByRole('button', { name: /left watermark/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /right watermark/i })).toBeTruthy();
    expect(screen.getAllByText('Drop or click to choose').every((text) => text.parentElement?.classList.contains('top-6'))).toBe(true);
    expect(screen.getAllByText('Drop or click to choose')).toHaveLength(2);
  });

  it('emits the selected PNG with its watermark side', async () => {
    const handleFileSelected = vi.fn();
    window.addEventListener(WATERMARK_FILE_SELECTED_EVENT, handleFileSelected);
    render(<WatermarkDropzones leftHasWatermark={false} rightHasWatermark={false} />);
    const file = new File(['png'], 'left.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.drop(screen.getByRole('button', { name: /left watermark/i }), dropData(file));
    });

    expect(handleFileSelected).toHaveBeenCalledTimes(1);
    expect(handleFileSelected.mock.calls[0][0]).toMatchObject({
      detail: { side: 'left', file },
    });
  });

  it('rejects non-PNG files and files larger than 2 MB', async () => {
    render(<WatermarkDropzones leftHasWatermark={false} rightHasWatermark={false} />);
    const right = screen.getByRole('button', { name: /right watermark/i });

    await act(async () => {
      fireEvent.drop(right, dropData(new File(['jpg'], 'right.jpg', { type: 'image/jpeg' })));
    });
    expect(screen.getByText('PNG files only.')).toBeTruthy();

    const largeFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'right.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.drop(right, dropData(largeFile));
    });
    expect(screen.getByText('Max 2 MB.')).toBeTruthy();
  });

  it('disables only the side whose upload is pending', async () => {
    render(<WatermarkDropzones leftHasWatermark={true} rightHasWatermark={false} />);
    const left = screen.getByRole('button', { name: /left watermark/i });
    expect(within(left).queryByText('Drop or click to choose')).toBeNull();
    expect(within(left).getByText('Replace watermark').classList.contains('top-6')).toBe(true);
    const right = screen.getByRole('button', { name: /right watermark/i });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(WATERMARK_UPLOAD_STATE_EVENT, {
        detail: { side: 'left', pending: true },
      }));
    });

    await waitFor(() => expect(left.getAttribute('aria-disabled')).toBe('true'));
    expect(right.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByText('Uploading left...').classList.contains('top-6')).toBe(true);
  });

  it('updates the visible prompt when a watermark is uploaded or removed', async () => {
    render(<WatermarkDropzones leftHasWatermark={false} rightHasWatermark={false} />);
    const left = screen.getByRole('button', { name: /left watermark/i });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(WATERMARK_UPLOAD_STATE_EVENT, {
        detail: { side: 'left', pending: false, hasWatermark: true },
      }));
    });
    expect(within(left).queryByText('Drop or click to choose')).toBeNull();
    expect(within(left).getByText('Replace watermark')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(WATERMARK_UPLOAD_STATE_EVENT, {
        detail: { side: 'left', pending: false, hasWatermark: false },
      }));
    });
    expect(within(left).getByText('Drop or click to choose')).toBeTruthy();
    expect(left.getAttribute('aria-disabled')).toBeNull();
  });
});
