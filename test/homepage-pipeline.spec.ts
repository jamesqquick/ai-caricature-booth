import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('homepage generation pipeline', () => {
  it('uses five synchronized stages and official Cloudflare product icons', async () => {
    const source = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
    const icons = await Promise.all(
      ['r2', 'workers-ai', 'workflows', 'images'].map((name) =>
        readFile(new URL(`../public/icons/cloudflare/${name}.svg`, import.meta.url), 'utf8'),
      ),
    );

    expect(source).toContain('Capture');
    expect(source).toContain('title: "Store"');
    expect(source).toContain('title: "Check"');
    expect(source).toContain('Create');
    expect(source).toContain('title: "Overlay"');
    expect(source).toContain('headline: "Take a selfie."');
    expect(source).toContain('headline: "Store in R2."');
    expect(source).toContain('headline: "Check for SFW."');
    expect(source).toContain('headline: "Create caricature."');
    expect(source).toContain('headline: "Add watermark."');
    expect(source).not.toContain('No app or account required.');
    expect(source).toContain('<SectionHeader title="How it works" />');
    expect(source).toContain('/icons/cloudflare/r2.svg');
    expect(source).toContain('/icons/cloudflare/workers-ai.svg');
    expect(source).toContain('/icons/cloudflare/workflows.svg');
    expect(source).toContain('/icons/cloudflare/images.svg');
    expect(source).toContain("pipeline.dataset.stage = String(stageIndex)");
    expect(source).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(source).toContain('data-pipeline-toggle');
    expect(source).toContain('const pipelineStageDurations = [1500, 3400, 3400, 3400, 3400];');
    expect(source).toContain("window.addEventListener('pageshow'");
    expect(source).toContain('reducedMotion.matches ? 4 : 0');
    expect(source).toContain('role="region" aria-label="Animated image processing pipeline"');
    expect(source).not.toContain('type: "spark"');
    expect(source).toContain('class="pipeline-shutter"');
    expect(source).toContain('class="pipeline-shutter-flash"');
    expect(source).toContain('data-pipeline-pause-icon');
    expect(source).toContain('data-pipeline-play-icon');
    expect(source).toContain('class="pipeline-loader"');
    expect(source).toContain('class="pipeline-save-icon"');
    expect(source).toContain('class="pipeline-watermark-target"');
    expect(source).toContain('import { Save } from "lucide-react";');
    expect(source).toContain('<Save aria-hidden="true"');
    expect(source).not.toContain('Paintbrush');
    expect(source).toContain('restartStageAnimation()');
    expect(source).toMatch(/<div class="pipeline-visual[^>]*data-pipeline[^>]*>\s*<Button[^>]*data-pipeline-toggle/);
    expect(source).toContain('<span>WATERMARK</span>');
    expect(source).not.toContain('<span>CARICATURE</span>');
    expect(source).not.toContain('pipeline-divider');
    expect(source).not.toContain('pipeline-status');
    expect(source).not.toContain('BEHIND THE SCENES');
    expect(source).not.toContain('STAGE 01 OF 04');
    expect(source).not.toContain('SELFIE · CARICATURE · POSTCARD');
    expect(source).not.toContain('selfie.jpg');
    expect(source).not.toContain('postcard.png');
    expect(icons.every((icon) => icon.startsWith('<svg'))).toBe(true);
  });

  it('derives the preview and rail presentation from the shared stage state', async () => {
    const styles = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

    expect(styles).toContain(".pipeline-visual[data-stage='0']");
    expect(styles).toContain(".pipeline-visual[data-stage='1']");
    expect(styles).toContain(".pipeline-visual[data-stage='2']");
    expect(styles).toContain(".pipeline-visual[data-stage='3']");
    expect(styles).toContain(".pipeline-visual[data-stage='4']");
    expect(styles).toContain('@keyframes pipeline-shutter-press');
    expect(styles).toContain('@keyframes pipeline-shutter-flash');
    expect(styles).toContain('@keyframes pipeline-upload-selfie');
    expect(styles).toContain('@keyframes pipeline-upload-spinner');
    expect(styles).toContain('@keyframes pipeline-check-selfie-enter');
    expect(styles).toContain('@keyframes pipeline-generate-selfie');
    expect(styles).toContain('@keyframes pipeline-generate-caricature');
    expect(styles).toContain(".pipeline-visual[data-stage='3'] .pipeline-result-image { animation: pipeline-generate-selfie 3.4s linear both; }");
    expect(styles).toContain(".pipeline-visual[data-stage='3'] .pipeline-result-caricature { animation: pipeline-generate-caricature 3.4s linear both; }");
    expect(styles).toContain('0%, 15% { filter: saturate(.45) contrast(1.08); opacity: .62;');
    expect(styles).toContain('85%, 100% { filter: saturate(.45) contrast(1.08); opacity: 0;');
    expect(styles).toContain('0%, 15% { opacity: 0; transform: scale(1.04); }');
    expect(styles).toContain('85%, 100% { opacity: 1; transform: scale(1); }');
    expect(styles).toContain('@keyframes pipeline-generate-ink');
    expect(styles).toContain(".pipeline-visual[data-stage='1'] .pipeline-loader");
    expect(styles).toContain(".pipeline-visual[data-stage='3'] .pipeline-loader");
    expect(styles).toContain(".pipeline-visual[data-stage='1'] .pipeline-save-icon");
    expect(styles).toContain(".pipeline-visual[data-stage='4'] .pipeline-watermark-target");
    expect(styles).toContain('.pipeline-save-icon { top: .75rem; left: .75rem; width: 3.25rem; height: 3.25rem; }');
    expect(styles).toContain('.pipeline-save-icon svg { width: 2.65rem;');
    expect(styles).toContain('.pipeline-watermark-target { right: .75rem; bottom: .75rem;');
    expect(styles).toContain(".pipeline-visual[data-paused='true'] .pipeline-loader");
    expect(styles).toContain(".pipeline-visual[data-paused='true'] .pipeline-save-icon");
    expect(styles).toContain(".pipeline-visual[data-paused='true'] .pipeline-watermark-target");
    expect(styles).toContain('@keyframes pipeline-save');
    expect(styles).toContain('@keyframes pipeline-watermark-target');
    expect(styles).toContain('@keyframes pipeline-watermark-reveal');
    expect(styles).not.toContain('CAMERA READY');
    expect(styles).not.toContain('UPLOADING TO R2');
    expect(styles).not.toContain('SAFETY CHECK');
    expect(styles).not.toContain('GENERATING ART');
    expect(styles).not.toContain('POSTCARD READY');
    expect(styles).toContain(".pipeline-node[data-state='complete']::after");
    expect(styles).not.toContain("content: 'QUEUED'");
    expect(styles).not.toContain("content: 'ACTIVE'");
    expect(styles).not.toContain("content: 'COMPLETE'");
    expect(styles).not.toContain('.pipeline-divider');
    expect(styles).not.toContain('.pipeline-status-dot');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('.pipeline-save-icon, .pipeline-watermark-target, .pipeline-shutter-flash, .pipeline-loader');
    expect(styles).toContain(".pipeline-visual[data-stage='0'] .pipeline-shutter { opacity: 1; animation: pipeline-shutter-press 1.5s");
  });
});
