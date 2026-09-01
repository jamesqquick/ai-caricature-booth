export function isPrintAgentPath(pathname: string) {
  return pathname === '/api/print-agent' || pathname.startsWith('/api/print-agent/');
}

export async function authenticatePrintAgent(request: Request, configuredToken: string | undefined): Promise<Response | null> {
  const expected = configuredToken?.trim();
  if (!expected) return Response.json({ error: 'Print agent authentication is not configured.' }, { status: 500 });

  const authorization = request.headers.get('authorization');
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!constantTimeEqual(supplied, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
