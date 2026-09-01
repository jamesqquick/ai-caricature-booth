/** @vitest-environment jsdom */

import { transform } from '@astrojs/compiler';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImagePreview } from '../src/components/admin/ImagePreview';
import { loadAdminSession } from '../src/db/admin';

const sessionDetailSource = new NodeURL('../src/pages/admin/sessions/[sessionId].astro', import.meta.url);
const timelineSource = new NodeURL('../src/components/admin/SessionTimeline.astro', import.meta.url);
const imagesSource = new NodeURL('../src/components/admin/SessionImages.astro', import.meta.url);
const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
  if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
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

  it('loads print history with the session in parallel and places it before the timeline', async () => {
    const source = await readFile(fileURLToPath(sessionDetailSource), 'utf8');

    expect(source).toContain("import { PrintHistory } from '../../../components/admin/PrintHistory';");
    expect(source).toMatch(/Promise\.all\(\[\s*loadAdminSession\(env\.DB, sessionId\),\s*loadAdminPrintJobs\(env\.DB, sessionId\),?\s*\]\)/);
    expect(source).toContain('<PrintHistory client:load');
    expect(source.indexOf('<PrintHistory client:load')).toBeGreaterThan(source.indexOf('id="final-postcard-heading"'));
    expect(source.indexOf('<PrintHistory client:load')).toBeLessThan(source.indexOf('<SessionTimeline session={session} />'));
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
    expect(source).toContain("import { ImagePreview } from '../../../components/admin/ImagePreview';");
    expect(source).toContain('id="final-postcard-heading"');
    expect(source).toContain('Final output');
    expect(source).toContain('src={`/api/admin/sessions/${encodeURIComponent(session.id)}/images/postcard`}');
    expect(source).toContain('downloadHref={`/api/admin/sessions/${encodeURIComponent(session.id)}/images/postcard?download=1`}');
    expect(source).toContain('Postcard unavailable');
    expect(source).toContain('Postcard in progress');
    expect(images).toContain('/api/admin/sessions/');
    expect(images).toContain('Image not saved');
    expect(source).not.toContain('selfie_key');
    expect(source).not.toContain('caricature_key');
    expect(source).not.toContain('postcard_key');
  });

  it('opens and closes the expanded preview with keyboard controls', () => {
    document.body.style.overflow = 'auto';
    const { container } = render(createElement(ImagePreview, { src: '/preview.jpg', alt: 'Generated caricature', downloadHref: '/download.jpg' }));
    const image = container.querySelector('img');
    if (!image) throw new Error('Expected a preview image.');
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

  it('supports a compact preview without a download action', () => {
    const { container } = render(createElement(ImagePreview, { src: '/postcard-thumb.jpg', fullSrc: '/postcard.jpg', alt: 'Final postcard', compact: true, showDownload: false }));
    const image = container.querySelector('img');
    if (!image) throw new Error('Expected a compact preview image.');
    expect(screen.getByRole('img', { name: 'Final postcard' }).querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('Loading')).toBeNull();
    fireEvent.load(image);

    expect(screen.getByAltText('Final postcard')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Final postcard' })).toBeTruthy();
    expect(screen.queryByText('Download image')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Final postcard' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('/postcard.jpg');
  });

  it('recognizes a cached image after the preview island hydrates', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, value: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, value: 640 });

    render(createElement(ImagePreview, { src: '/preview.jpg', alt: 'Generated caricature', downloadHref: '/download.jpg' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Expand Generated caricature' }).getAttribute('disabled')).toBeNull());
    expect(screen.queryByText('Loading preview...')).toBeNull();
  });

  it('renders a neutral image placeholder without a retry action', () => {
    const { container } = render(createElement(ImagePreview, { src: '/preview.jpg', alt: 'Generated caricature', downloadHref: '/download.jpg' }));
    const image = container.querySelector('img');
    if (!image) throw new Error('Expected a preview image.');
    fireEvent.error(image);

    expect(screen.getByRole('alert', { name: 'Generated caricature' }).querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('Loading preview...')).toBeNull();
    expect(screen.queryByText('The image could not be loaded.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry preview' })).toBeNull();
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
