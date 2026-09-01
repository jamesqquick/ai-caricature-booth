export function isPrintAgentPath(pathname: string) {
  return pathname === '/api/print-agent' || pathname.startsWith('/api/print-agent/');
}

export async function authenticatePrintAgent(request: Request, configuredToken: string | undefined): Promise<Response | null> {
  const expected = configuredToken?.trim();
  if (!expected) return Response.json({ error: 'Print agent authentication is not configured.' }, { status: 500 });

  const authorization = request.headers.get('authorization');
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!await constantTimeEqual(supplied, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

type TimingSafeSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean;
};

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const subtle = crypto.subtle as TimingSafeSubtleCrypto;
  const [leftHash, rightHash] = await Promise.all([
    subtle.digest('SHA-256', encoder.encode(left)),
    subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  return subtle.timingSafeEqual(leftHash, rightHash);
}
