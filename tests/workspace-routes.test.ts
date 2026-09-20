import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPerformanceRoute, workspaceRoutes } from '../src/lib/workspace-routes';
import { readSnapshot, snapshotLink } from '../src/lib/storage';
import { createBlankWorkbook } from '../src/lib/seed';

afterEach(() => vi.unstubAllGlobals());

describe('workspace routes on static hosts', () => {
  it.each(['/', '/lumina-sheets/'])('keeps every navigation inside deployment base %s', (base) => {
    const routes = workspaceRoutes(base);
    const origin = 'https://example.github.io';
    expect(new URL(routes.workspace, origin).pathname).toBe(base);
    expect(new URL(routes.report, origin).pathname).toBe(`${base}examples/report.html`);
    const performance = new URL(routes.performance, origin);
    // A refresh requests the deployed index, not a nonexistent /performance file.
    expect(performance.pathname).toBe(base);
    expect(isPerformanceRoute(performance.pathname, performance.search, base)).toBe(true);
    expect(isPerformanceRoute(base, '', base)).toBe(false);
    expect(isPerformanceRoute(`${base}index.html`, '?view=performance', base)).toBe(true);
    expect(isPerformanceRoute(`${base}performance`, '', base)).toBe(true);
    expect(isPerformanceRoute(`${base}performance/`, '', base)).toBe(true);
    expect(isPerformanceRoute(`${base}examples/report.html`, '?view=performance', base)).toBe(
      false,
    );
  });

  it('normalizes a missing trailing slash without matching another deployment', () => {
    expect(workspaceRoutes('/lumina-sheets')).toEqual(workspaceRoutes('/lumina-sheets/'));
    expect(isPerformanceRoute('/performance', '', '/lumina-sheets/')).toBe(false);
    expect(isPerformanceRoute('/', '?view=performance', '/lumina-sheets/')).toBe(false);
    expect(isPerformanceRoute('/other/', '?view=performance', '/lumina-sheets/')).toBe(false);
    expect(isPerformanceRoute('/lumina-sheets/', '?view=workspace', '/lumina-sheets/')).toBe(false);
  });

  it.each(['/', '/lumina-sheets/', '/lumina-sheets/index.html'])(
    'shares and restores snapshots at the same deployed workspace path %s',
    (pathname) => {
      const location = { origin: 'https://example.github.io', pathname, hash: '' };
      vi.stubGlobal('location', location);
      const workbook = createBlankWorkbook('共享测试');
      workbook.sheets[0].cells.A1 = { value: '跨路径快照' };
      const url = new URL(snapshotLink(workbook));
      expect(url.origin).toBe(location.origin);
      expect(url.pathname).toBe(pathname);
      expect(isPerformanceRoute(url.pathname, url.search, '/lumina-sheets/')).toBe(false);
      location.hash = url.hash;
      expect(readSnapshot()).toEqual(workbook);
    },
  );
});
