export interface ValidationOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ValidationOverlayLayout {
  trigger: ValidationOverlayRect;
  picker: { left: number; top: number; width: number; maxHeight: number };
}

const MARGIN = 4;
const GAP = 4;
const MAX_PICKER_SIZE = 320;

/** All coordinates are already projected and zoomed CSS pixels within the shell. */
export function validationOverlayLayout(
  rect: ValidationOverlayRect,
  viewport: { width: number; height: number },
  insets: { left: number; top: number },
): ValidationOverlayLayout | null {
  if (
    ![
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      viewport.width,
      viewport.height,
      insets.left,
      insets.top,
    ].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    viewport.width <= MARGIN * 2 ||
    viewport.height <= MARGIN * 2
  )
    return null;

  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
  const visibleLeft = Math.max(rect.left, insets.left, MARGIN);
  const visibleTop = Math.max(rect.top, insets.top, MARGIN);
  const visibleRight = Math.min(right, viewport.width - MARGIN);
  const visibleBottom = Math.min(bottom, viewport.height - MARGIN);
  const visibleWidth = visibleRight - visibleLeft;
  const visibleHeight = visibleBottom - visibleTop;
  if (visibleWidth < 20 || visibleHeight < 18) return null;

  // A 20–23px fragment still gets a usable button without covering row headers.
  const triggerWidth = Math.min(24, visibleWidth);
  const triggerHeight = Math.min(24, visibleHeight);
  const trigger = {
    left: visibleRight - triggerWidth,
    top: visibleTop + (visibleHeight - triggerHeight) / 2,
    width: triggerWidth,
    height: triggerHeight,
  };

  const width = Math.min(MAX_PICKER_SIZE, viewport.width - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(visibleRight - width, viewport.width - MARGIN - width));
  const below = Math.max(0, viewport.height - MARGIN - visibleBottom - GAP);
  const above = Math.max(0, visibleTop - MARGIN - GAP);
  let top: number;
  let maxHeight: number;

  if (below < 160 && above < 160) {
    // Short shells and large merged cells need an overlay rather than a tiny
    // list. The picker may cover the cell/headers, but stays inside the shell.
    maxHeight = Math.min(MAX_PICKER_SIZE, viewport.height - MARGIN * 2);
    top = (viewport.height - maxHeight) / 2;
  } else if (below < 180 && above > below) {
    maxHeight = Math.min(MAX_PICKER_SIZE, above);
    top = visibleTop - GAP - maxHeight;
  } else {
    maxHeight = Math.min(MAX_PICKER_SIZE, below);
    top = visibleBottom + GAP;
  }

  return { trigger, picker: { left, top, width, maxHeight } };
}
