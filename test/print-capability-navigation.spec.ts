import { describe, expect, it, vi } from 'vitest';
import { completeGenerationNavigation, printCapabilityStorageKey } from '../src/lib/print-capability-storage';

const sessionId = '00000000-0000-4000-8000-000000000001';

describe('generation print capability navigation', () => {
  it('stores the capability by session before canonical generation navigation', () => {
    const calls: string[] = [];
    const storage = {
      setItem: vi.fn((key: string, value: string) => calls.push(`store:${key}:${value}`)),
    };
    const navigate = vi.fn((url: string) => calls.push(`navigate:${url}`));

    completeGenerationNavigation(sessionId, 'signed-print-token', storage, navigate);

    expect(storage.setItem).toHaveBeenCalledWith(printCapabilityStorageKey(sessionId), 'signed-print-token');
    expect(navigate).toHaveBeenCalledWith(`/p/${sessionId}?source=generation`);
    expect(calls).toEqual([
      `store:${printCapabilityStorageKey(sessionId)}:signed-print-token`,
      `navigate:/p/${sessionId}?source=generation`,
    ]);
  });
});
