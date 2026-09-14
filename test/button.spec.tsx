/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button, buttonVariants } from '../src/components/ui/button';

afterEach(cleanup);

describe('Button', () => {
  it('uses primary as the default semantic variant', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('bg-primary');
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-primary');
  });

  it.each([
    ['secondary', 'bg-secondary'],
    ['outline', 'bg-transparent'],
    ['destructive', 'bg-destructive'],
    ['destructiveOutline', 'text-destructive'],
    ['ghost', 'bg-transparent'],
    ['contrast', 'bg-foreground'],
  ] as const)('renders the %s variant', (variant, expectedClass) => {
    expect(buttonVariants({ variant })).toContain(expectedClass);
  });

  it('uses a 44px icon target', () => {
    expect(buttonVariants({ size: 'icon' })).toContain('size-11');
  });

  it('shows a pointer cursor for enabled controls', () => {
    expect(buttonVariants()).toContain('cursor-pointer');
  });

  it('passes the button contract through Slot', () => {
    render(
      <Button asChild variant="outline">
        <a href="/admin/events">Events</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Events' });
    expect(link.getAttribute('href')).toBe('/admin/events');
    expect(link.className).toContain('border-border');
  });
});
