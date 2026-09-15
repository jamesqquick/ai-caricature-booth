import { readFile } from 'node:fs/promises';
import { URL as NodeURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { soundEnabledFromStoredValue } from '../src/lib/sound';

describe('sound preference', () => {
  it('defaults to enabled when no preference is stored', () => {
    expect(soundEnabledFromStoredValue(null)).toBe(true);
  });

  it('restores an explicit muted preference', () => {
    expect(soundEnabledFromStoredValue('false')).toBe(false);
  });

  it('restores an explicit enabled preference', () => {
    expect(soundEnabledFromStoredValue('true')).toBe(true);
  });

  it('uses the shared outline icon controls and Lucide sound icons', async () => {
    const source = await readFile(new NodeURL('../src/components/Navbar.astro', import.meta.url), 'utf8');

    expect(source).toContain("import { Moon, Sun, Volume2, VolumeX } from 'lucide-react'");
    expect(source).toContain("buttonVariants({ variant: 'outline', size: 'icon' })");
    expect(source).toContain('data-sound-on-icon');
    expect(source).toContain('data-sound-off-icon');
    expect(source).toContain('hover:text-primary');
    expect(source).toContain('hover:[&_svg]:scale-110');
    expect(source).toContain('hover:[&_svg]:rotate-[4deg]');
    expect(source).toContain('motion-reduce:hover:[&_svg]:scale-100');
    expect(source).toContain('motion-reduce:hover:[&_svg]:rotate-0');
    expect(source).toContain("const navbarHomeIconHover = 'transition-transform duration-200 group-hover:scale-110 group-hover:rotate-[4deg] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-hover:rotate-0'");
    expect(source).toContain("class={cn('size-9', navbarHomeIconHover)}");
    expect(source).not.toContain('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"');
  });
});
