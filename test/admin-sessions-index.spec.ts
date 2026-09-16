import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sessionsIndexUrl = new URL('../src/pages/admin/sessions/index.astro', import.meta.url);

describe('admin sessions index', () => {
  it('compiles as a dedicated admin page using the shared layout and sessions list', async () => {
    const source = await readFile(sessionsIndexUrl, 'utf8');
    const result = await transform(source, { filename: 'src/pages/admin/sessions/index.astro' });

    expect(result.diagnostics).toEqual([]);
    expect(source).toContain("from '../../../components/admin/AdminSessionsList'");
    expect(source).toContain("import AdminLayout from '../../../layouts/AdminLayout.astro'");
    expect(source).toContain("import PageHeader from '../../../components/admin/PageHeader.astro'");
    expect(source).toContain('title="Sessions"');
    expect(source).toContain('Browse and filter booth sessions by event, status, and date.');
    expect(source).toContain('<AdminSessionsList');
    expect(source).toContain('client:load');
    expect(source).toContain('showPagination={true}');
    expect(source).toContain('basePath="/admin/sessions"');
    expect(source).toContain('dataLabel="Session"');
  });

  it('normalizes a fixed 30-row page and loads event options and sessions from D1', async () => {
    const source = await readFile(sessionsIndexUrl, 'utf8');

    expect(source).toContain('ADMIN_SESSION_PAGE_SIZE');
    expect(source).toContain('normalizeAdminFilters(params, undefined, { pageSize: ADMIN_SESSION_PAGE_SIZE })');
    expect(source).toContain('loadAdminEventOptions(env.DB)');
    expect(source).toContain('loadAdminSessions(env.DB, filters)');
    expect(source).toContain('toAdminSessionListResult');
  });

  it('redirects incoming pageSize to the normalized public URL before loading data', async () => {
    const source = await readFile(sessionsIndexUrl, 'utf8');
    const redirectIndex = source.indexOf('canonicalAdminSessionsFilterUrl(params, filters)');
    const loadIndex = source.indexOf('await Promise.allSettled');

    expect(source).toContain('canonicalAdminSessionsFilterUrl');
    expect(redirectIndex).toBeGreaterThan(-1);
    expect(loadIndex).toBeGreaterThan(redirectIndex);
    expect(source).toContain('if (canonicalFilterUrl) return Astro.redirect(canonicalFilterUrl);');
  });

  it('keeps validation responses distinct and converts loader failures into list recovery state', async () => {
    const source = await readFile(sessionsIndexUrl, 'utf8');

    expect(source).toContain('error instanceof AdminFilterValidationError');
    expect(source).toContain('Astro.response.status = 400');
    expect(source).toContain('Invalid ${error.field} filter. Update the filters and try again.');
    expect(source).toContain('Promise.allSettled');
    expect(source).toContain('initialLoadError={sessionsPage.initialLoadError}');
    expect(source).toContain("Some session data couldn't be loaded. Try again.");
    expect(source).toMatch(/if \(sessionsResult\.status === 'rejected'\) \{[\s\S]*Astro\.response\.status = 503;/);
    expect(source).toMatch(/const sessionResult = sessionsResult\.status === 'fulfilled'[\s\S]*?: null;/);
  });

  it('requires a current-route reload when server-loaded event options are missing', async () => {
    const source = await readFile(sessionsIndexUrl, 'utf8');

    expect(source).toContain("type: 'reload'");
    expect(source).not.toContain('href: `${Astro.url.pathname}${Astro.url.search}`');
    expect(source).toContain("type: 'refresh'");
    expect(source).toContain('initialLoadErrorRecovery={sessionsPage.initialLoadErrorRecovery}');
  });

  it('redirects an out-of-range successful result before rendering the sessions island', async () => {
    const source = await readFile(sessionsIndexUrl, 'utf8');

    expect(source).toContain('canonicalAdminSessionsPageUrl');
    expect(source).toContain('canonicalAdminSessionsPageUrl(params, filters.page, sessionResult.totalPages)');
    expect(source).toContain('return Astro.redirect(canonicalUrl);');
  });
});
