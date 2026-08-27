import { ADMIN_EMAIL_HEADER } from './admin-access';

export const ADMIN_NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Events', href: '/admin/events' },
] as const;

export function getAdminEmail(request: Request) {
  return request.headers.get(ADMIN_EMAIL_HEADER)?.trim() || 'Unknown admin';
}

export function isAdminNavItemActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === href || pathname === `${href}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}
