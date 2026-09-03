import { describe, expect, it } from 'vitest';
import {
  issuePrintCapability,
  PrintCapabilityExpiredError,
  PrintCapabilityInvalidError,
  verifyPrintCapability,
} from '../src/lib/print-capability';

const secret = 'test-print-capability-secret-with-enough-entropy';
const sessionId = '00000000-0000-4000-8000-000000000001';

describe('print capability', () => {
  it('signs and verifies a session/event/expiration-bound capability', async () => {
    const token = await issuePrintCapability(secret, { sessionId, eventId: 7 }, 1_000);

    await expect(verifyPrintCapability(secret, token, { sessionId, eventId: 7 }, 1_001)).resolves.toMatchObject({
      sessionId,
      eventId: 7,
      expiresAt: 1_000 + 2 * 60 * 60,
    });
  });

  it('rejects tampering without exposing token details', async () => {
    const token = await issuePrintCapability(secret, { sessionId, eventId: 7 }, 1_000);
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    await expect(verifyPrintCapability(secret, tampered, { sessionId, eventId: 7 }, 1_001))
      .rejects.toBeInstanceOf(PrintCapabilityInvalidError);
  });

  it('rejects expired and differently bound capabilities', async () => {
    const token = await issuePrintCapability(secret, { sessionId, eventId: 7 }, 1_000);

    await expect(verifyPrintCapability(secret, token, { sessionId, eventId: 7 }, 8_201))
      .rejects.toBeInstanceOf(PrintCapabilityExpiredError);
    await expect(verifyPrintCapability(secret, token, { sessionId, eventId: 8 }, 1_001))
      .rejects.toBeInstanceOf(PrintCapabilityInvalidError);
    await expect(verifyPrintCapability(secret, token, {
      sessionId: '00000000-0000-4000-8000-000000000002',
      eventId: 7,
    }, 1_001)).rejects.toBeInstanceOf(PrintCapabilityInvalidError);
  });
});
