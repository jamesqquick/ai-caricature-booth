/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from '../src/components/ui/input';

afterEach(cleanup);

describe('Input', () => {
  it('uses the standard 48px control height by default', () => {
    render(<Input aria-label="Width" type="number" />);

    const input = screen.getByLabelText('Width');
    expect(input.classList.contains('h-12')).toBe(true);
    expect(input.classList.contains('focus-visible:outline-primary')).toBe(true);
  });

  it('supports the compact 44px control height', () => {
    render(<Input aria-label="From" size="sm" type="date" />);

    expect(screen.getByLabelText('From').classList.contains('h-11')).toBe(true);
  });

  it('constrains the file chooser to the control height', () => {
    render(<Input aria-label="PNG image" type="file" />);

    const input = screen.getByLabelText('PNG image');
    expect(input.classList.contains('h-12')).toBe(true);
    expect(input.classList.contains('file:h-10')).toBe(true);
  });
});
