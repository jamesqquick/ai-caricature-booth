/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button, buttonVariants } from '../src/components/ui/button';

afterEach(cleanup);

describe('Button', () => {
  it('uses primary as the default semantic variant', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('bg-primary');
    expect(buttonVariants({ variant: 'primary' })).toContain('border-primary');
    expect(buttonVariants({ variant: 'primary' })).not.toContain('border-transparent');
    expect(buttonVariants({ variant: 'primary' })).toContain('whitespace-nowrap');
    expect(buttonVariants({ variant: 'primary' })).not.toContain('border-current');
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

  it.each([
    ['sm', 'text-xs', 'text-sm'],
    ['lg', 'text-base', 'text-sm'],
  ] as const)('preserves the %s typography', (size, expectedClass, conflictingClass) => {
    const classes = buttonVariants({ size });

    expect(classes).toContain(expectedClass);
    expect(classes).not.toContain(conflictingClass);
  });

  it('shows a pointer cursor for enabled controls', () => {
    const classes = buttonVariants();

    expect(classes).toContain('cursor-pointer');
    expect(classes).toContain('disabled:cursor-default');
    expect(classes).toContain('aria-disabled:cursor-default');
  });

  it('supports bespoke controls without visual defaults', () => {
    const classes = buttonVariants({ variant: 'unstyled', size: 'unstyled' });

    expect(classes).toContain('cursor-pointer');
    expect(classes).toContain('bg-transparent');
    expect(classes).toContain('min-h-0');
    expect(classes).not.toContain('border-primary');
    expect(classes).not.toContain('min-h-12');
    expect(classes).not.toContain('rounded-full');
    expect(classes).not.toContain('text-sm');
    expect(classes).not.toContain('font-bold');
    expect(classes).not.toContain('transition-[');
    expect(classes).not.toContain('[&_svg]:size-4');
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
    expect(link.className).toContain('no-underline');
  });
});
