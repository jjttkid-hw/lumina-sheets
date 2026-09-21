/** Return focus after React removes an editor only if the host has not moved it. */
export function returnFocusNextFrame(
  target: HTMLElement | null,
  boundary: HTMLElement | null = target,
): void {
  if (!target) return;
  const document = target.ownerDocument;
  const origin = document.activeElement;
  if (
    origin &&
    origin !== document.body &&
    origin !== document.documentElement &&
    !boundary?.contains(origin)
  )
    return;
  requestAnimationFrame(() => {
    if (!target.isConnected) return;
    const active = document.activeElement;
    if (active !== origin && active !== document.body && active !== document.documentElement)
      return;
    target.focus({ preventScroll: true });
  });
}
