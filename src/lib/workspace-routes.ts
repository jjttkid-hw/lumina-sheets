/// <reference types="vite/client" />

/** URLs that work with both a root deployment and Vite's configured subdirectory. */
export function workspaceRoutes(base = import.meta.env.BASE_URL) {
  const root = base.endsWith('/') ? base : `${base}/`;
  return {
    workspace: root,
    // Static hosts can refresh this URL without an SPA fallback or a custom 404.
    performance: `${root}?view=performance`,
    report: `${root}examples/report.html`,
  };
}

export function isPerformanceRoute(
  pathname: string,
  search: string,
  base = import.meta.env.BASE_URL,
): boolean {
  const { workspace } = workspaceRoutes(base);
  const path = pathname.replace(/\/$/, '');
  // Keep the existing development URL usable when the dev server provides its fallback.
  if (path === `${workspace}performance`) return true;
  const isWorkspace = path === workspace.replace(/\/$/, '') || path === `${workspace}index.html`;
  return isWorkspace && new URLSearchParams(search).get('view') === 'performance';
}
