export function isMcpPath(pathname: string) {
  return pathname === '/mcp';
}

export async function authenticateMcpRequest(request: Request, configuredToken: string | undefined): Promise<Response | null> {
  const expected = configuredToken?.trim();
  if (!expected) return Response.json({ error: 'MCP authentication is not configured.' }, { status: 500 });

  const authorization = request.headers.get('authorization');
  const supplied = authorization?.match(/^Bearer (.+)$/i)?.[1] ?? '';
  if (await constantTimeEqual(supplied, expected)) return null;

  return Response.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  );
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
