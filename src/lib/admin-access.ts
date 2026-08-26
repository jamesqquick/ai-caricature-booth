import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ADMIN_EMAIL_HEADER = 'x-booth-admin-email';

type AdminAccessContext = {
  getIdentity(): Promise<{ email?: string } | undefined>;
};

type AdminAccessConfig = {
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
};

export function isAdminApiPath(pathname: string) {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export function isAdminPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/') || isAdminApiPath(pathname);
}

function requestWithAdminEmail(request: Request, email: string) {
  const headers = new Headers(request.headers);
  headers.delete(ADMIN_EMAIL_HEADER);
  headers.set(ADMIN_EMAIL_HEADER, email);
  return new Request(request, { headers });
}

function isLoopbackRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

async function verifiedJwtEmail(request: Request, config: AdminAccessConfig) {
  const audience = config.ACCESS_AUD?.trim();
  const teamDomain = config.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, '');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!audience || !teamDomain || !token) return null;

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience,
    });
    return typeof payload.email === 'string' ? payload.email.trim() || null : null;
  } catch {
    return null;
  }
}

export async function withVerifiedAdminIdentity(
  request: Request,
  access: AdminAccessContext | undefined,
  config: AdminAccessConfig = {},
  allowLocalDevelopment = false,
) {
  if (!access) {
    const email = await verifiedJwtEmail(request, config);
    if (email) return requestWithAdminEmail(request, email);
    if (allowLocalDevelopment && isLoopbackRequest(request)) {
      return requestWithAdminEmail(request, 'local-admin@localhost');
    }
    return null;
  }

  try {
    const identity = await access.getIdentity();
    const email = identity?.email?.trim();
    if (!email) return null;

    return requestWithAdminEmail(request, email);
  } catch {
    return null;
  }
}

export function adminForbiddenResponse(pathname: string) {
  if (isAdminApiPath(pathname)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  return new Response('<!doctype html><html lang="en"><title>Forbidden</title><h1>Forbidden</h1></html>', {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
