/** @vitest-environment jsdom */

import { transform } from '@astrojs/compiler';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImagePreview } from '../src/components/admin/ImagePreview';
import { loadAdminSession } from '../src/db/admin';

const sessionDetailSource = new NodeURL('../src/pages/admin/sessions/[sessionId].astro', import.meta.url);
const timelineSource = new NodeURL('../src/components/admin/SessionTimeline.astro', import.meta.url);
const imagesSource = new NodeURL('../src/components/admin/SessionImages.astro', import.meta.url);

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function createDatabase(row: unknown) {
  return {
    prepare(sql: string) {
      expect(sql).toContain('WHERE s.id = ?');
      return {
        bind(id: string) {
          expect(id).toBe('admin-demo-001');
          return this;
        },
        async first() {
          return row;
        },
      };
    },
  } as unknown as D1Database;
}

describe('admin session detail', () => {
  it('loads one session as a safe detail model without raw image keys', async () => {
    const result = await loadAdminSession(createDatabase({
      session_id: 'admin-demo-001',
      event_id: 7,
      event_name: 'Demo Event',
      event_slug: 'demo-event',
      scene_id: 'subway',
      scene_name: 'Subway Platform',
      status: 'errored',
      created_at: 100,
      updated_at: 300,
      completed_at: null,
      error_message: 'Moderation failed',
      workflow_id: 'workflow-2',
      has_selfie: 1,
      has_caricature: 0,
      has_postcard: 0,
      selfie_key: 'must-not-leak',
    }), 'admin-demo-001');

    expect(result).toMatchObject({ id: 'admin-demo-001', status: 'errored', hasSelfie: true, hasCaricature: false });
    expect(result).not.toHaveProperty('selfieKey');
    expect(result).not.toHaveProperty('selfie_key');
  });

  it('returns null for an unknown session', async () => {
    await expect(loadAdminSession(createDatabase(null), 'admin-demo-001')).resolves.toBeNull();
  });

  it('compiles the detail route and timeline', async () => {
    const sources = await Promise.all([sessionDetailSource, timelineSource, imagesSource].map((url) => readFile(fileURLToPath(url), 'utf8')));
    const results = await Promise.all(sources.map((source, index) => transform(source, { filename: ['session-detail.astro', 'session-timeline.astro', 'session-images.astro'][index] })));
    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  });

  it('documents observed state and absent persisted stage timestamps', async () => {
    const source = await readFile(fileURLToPath(timelineSource), 'utf8');
    expect(source).toContain('Current status');
    expect(source).toContain('No timestamp stored');
    expect(source).toContain('Not available');
    expect(source).not.toContain('Date.now');
  });

  it('renders proxy-backed image inspection and explicit unavailable states', async () => {
    const source = await readFile(fileURLToPath(sessionDetailSource), 'utf8');
    const images = await readFile(fileURLToPath(imagesSource), 'utf8');
    expect(source).toContain('<SessionImages session={session} />');
    expect(images).toContain('/api/admin/sessions/');
    expect(images).toContain('Image not saved');
    expect(source).not.toContain('selfie_key');
    expect(source).not.toContain('caricature_key');
    expect(source).not.toContain('postcard_key');
  });

  it('opens and closes the expanded preview with keyboard controls', () => {
    document.body.style.overflow = 'auto';
    render(createElement(ImagePreview, { src: '/preview.jpg', alt: 'Generated caricature', downloadHref: '/download.jpg' }));
    const image = screen.getByAltText('Generated caricature');
    fireEvent.load(image);
    const trigger = screen.getByRole('button', { name: 'Expand Generated caricature' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close preview' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('announces image errors and offers a touch-sized retry control', () => {
    render(createElement(ImagePreview, { src: '/preview.jpg', alt: 'Generated caricature', downloadHref: '/download.jpg' }));
    fireEvent.error(screen.getByAltText('Generated caricature'));

    expect(screen.getByRole('alert').textContent).toContain("We couldn't load this image.");
    const retry = screen.getByRole('button', { name: 'Retry preview' });
    expect(retry.className).toContain('min-h-11');
    fireEvent.click(retry);
    expect(screen.getByRole('status').textContent).toContain('Loading image');
  });

  it('keeps the artifact grid stacked on small screens', async () => {
    const source = await readFile(fileURLToPath(imagesSource), 'utf8');
    expect(source).toContain('grid gap-5 sm:grid-cols-2 lg:grid-cols-3');
    expect(source).toContain('min-h-56');
  });

  it('distinguishes a recoverable data failure from malformed and missing sessions', async () => {
    const source = await readFile(fileURLToPath(sessionDetailSource), 'utf8');
    expect(source).toContain("console.error('Admin session detail load failed'");
    expect(source).toContain('const responseStatus = loadFailed ? 503');
    expect(source).toContain("loadFailed ? 'Retry' : 'Back to dashboard'");
  });
});
