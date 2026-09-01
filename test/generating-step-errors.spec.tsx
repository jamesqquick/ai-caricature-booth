import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('GeneratingStep errors', () => {
  it('validates and maps failureCode without reading a raw action error field', async () => {
    const component = await readFile(new URL('../src/components/steps/GeneratingStep.tsx', import.meta.url), 'utf8');
    const actions = await readFile(new URL('../src/actions/index.ts', import.meta.url), 'utf8');

    expect(component).toContain('isGenerationFailureCode(status.data.failureCode)');
    expect(component).toContain('generationFailureContent[failureCode].message');
    expect(component).not.toContain('status.data.error');
    expect(actions).not.toContain('{ error?: never }');
  });
});
