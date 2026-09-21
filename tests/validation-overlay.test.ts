import { describe, expect, it } from 'vitest';
import { validationOverlayLayout } from '../src/lib/canvas/validation-overlay';

const viewport = { width: 800, height: 600 };
const insets = { left: 42, top: 28 };

describe('validation overlay geometry', () => {
  it('uses projected, zoomed coordinates without applying zoom a second time', () => {
    expect(
      validationOverlayLayout({ left: 135, top: 105, width: 180, height: 54 }, viewport, {
        left: 63,
        top: 42,
      }),
    ).toEqual({
      trigger: { left: 291, top: 120, width: 24, height: 24 },
      picker: { left: 4, top: 163, width: 320, maxHeight: 320 },
    });
  });

  it('anchors to the right edge of a partially clipped horizontal cell', () => {
    const result = validationOverlayLayout(
      { left: 750, top: 100, width: 200, height: 36 },
      viewport,
      insets,
    );
    expect(result?.trigger).toEqual({ left: 772, top: 106, width: 24, height: 24 });
    expect(result?.picker).toEqual({ left: 476, top: 140, width: 320, maxHeight: 320 });
  });

  it('clips left and top to the header or frozen-pane inset', () => {
    const result = validationOverlayLayout(
      { left: -80, top: 40, width: 180, height: 80 },
      viewport,
      { left: 60, top: 90 },
    );
    expect(result?.trigger).toEqual({ left: 76, top: 93, width: 24, height: 24 });
    expect(result?.picker.top).toBe(124);
    expect(
      validationOverlayLayout({ left: 40, top: 30, width: 30, height: 70 }, viewport, {
        left: 60,
        top: 90,
      }),
    ).toBeNull();
  });

  it('uses the visible fragment height and permits the minimum usable dimensions', () => {
    const result = validationOverlayLayout(
      { left: 42, top: 20, width: 20, height: 26 },
      viewport,
      insets,
    );
    expect(result?.trigger).toEqual({ left: 42, top: 28, width: 20, height: 18 });
    expect(
      validationOverlayLayout({ left: 42, top: 28, width: 19.99, height: 36 }, viewport, insets),
    ).toBeNull();
    expect(
      validationOverlayLayout({ left: 42, top: 28, width: 100, height: 17.99 }, viewport, insets),
    ).toBeNull();
  });

  it('keeps a 4px edge margin even when supplied insets are absent or negative', () => {
    const result = validationOverlayLayout(
      { left: -20, top: -20, width: 100, height: 70 },
      viewport,
      { left: -1, top: -1 },
    );
    expect(result?.trigger).toEqual({ left: 56, top: 15, width: 24, height: 24 });
    expect(result?.picker.left).toBe(4);
  });

  it('places the picker above when the lower side is small and the upper side is larger', () => {
    expect(
      validationOverlayLayout({ left: 500, top: 500, width: 100, height: 36 }, viewport, insets)
        ?.picker,
    ).toEqual({ left: 280, top: 176, width: 320, maxHeight: 320 });
  });

  it('prefers below when at least 180px is available even if above is larger', () => {
    const result = validationOverlayLayout(
      { left: 100, top: 376, width: 100, height: 36 },
      viewport,
      insets,
    );
    expect(result?.picker).toEqual({ left: 4, top: 416, width: 320, maxHeight: 180 });
  });

  it('uses the larger upper side when below falls just under 180px', () => {
    const result = validationOverlayLayout(
      { left: 100, top: 377, width: 100, height: 36 },
      viewport,
      insets,
    );
    expect(result?.picker).toEqual({ left: 4, top: 53, width: 320, maxHeight: 320 });
  });

  it('uses a 160px lower side instead of covering the cell when it meets the minimum', () => {
    const result = validationOverlayLayout(
      { left: 50, top: 100, width: 100, height: 36 },
      { width: 390, height: 304 },
      insets,
    );
    expect(result?.picker).toEqual({ left: 4, top: 140, width: 320, maxHeight: 160 });
  });

  it('centers a useful overlay when both sides have less than 160px', () => {
    const result = validationOverlayLayout(
      { left: 50, top: 100, width: 100, height: 36 },
      { width: 390, height: 303 },
      insets,
    );
    expect(result?.picker).toEqual({ left: 4, top: 4, width: 320, maxHeight: 295 });
  });

  it('adapts both controls to an extremely narrow and short viewport', () => {
    expect(
      validationOverlayLayout(
        { left: 0, top: 0, width: 100, height: 100 },
        { width: 28, height: 26 },
        { left: 0, top: 0 },
      ),
    ).toEqual({
      trigger: { left: 4, top: 4, width: 20, height: 18 },
      picker: { left: 4, top: 4, width: 20, maxHeight: 18 },
    });
    expect(
      validationOverlayLayout(
        { left: 0, top: 0, width: 100, height: 100 },
        { width: 27, height: 26 },
        { left: 0, top: 0 },
      ),
    ).toBeNull();
  });

  it('clips a large merged cell and keeps its centered picker inside the shell', () => {
    expect(
      validationOverlayLayout(
        { left: -10_000, top: -20_000, width: 30_000, height: 40_000 },
        { width: 390, height: 844 },
        insets,
      ),
    ).toEqual({
      trigger: { left: 362, top: 422, width: 24, height: 24 },
      picker: { left: 66, top: 262, width: 320, maxHeight: 320 },
    });
  });

  it.each([
    { left: -200, top: 100, width: 100, height: 36 },
    { left: 800, top: 100, width: 100, height: 36 },
    { left: 100, top: -100, width: 100, height: 36 },
    { left: 100, top: 600, width: 100, height: 36 },
    { left: 0, top: 0, width: 42, height: 28 },
    { left: 100, top: 100, width: 0, height: 36 },
    { left: 100, top: 100, width: 100, height: -1 },
  ])('returns null for an invisible or empty rectangle %j', (rect) => {
    expect(validationOverlayLayout(rect, viewport, insets)).toBeNull();
  });

  it.each([
    { width: 0, height: 600 },
    { width: 800, height: 0 },
    { width: -10, height: 600 },
    { width: 8, height: 600 },
    { width: 800, height: 8 },
  ])('returns null for an empty or unusable viewport %j', (size) => {
    expect(
      validationOverlayLayout({ left: 100, top: 100, width: 100, height: 36 }, size, insets),
    ).toBeNull();
  });

  it('rejects non-finite geometry and overflow without producing invalid CSS numbers', () => {
    const rect = { left: 100, top: 100, width: 100, height: 36 };
    expect(validationOverlayLayout({ ...rect, left: NaN }, viewport, insets)).toBeNull();
    expect(validationOverlayLayout(rect, { ...viewport, width: Infinity }, insets)).toBeNull();
    expect(validationOverlayLayout(rect, viewport, { ...insets, top: NaN })).toBeNull();
    expect(
      validationOverlayLayout(
        { ...rect, left: Number.MAX_VALUE, width: Number.MAX_VALUE },
        viewport,
        insets,
      ),
    ).toBeNull();
  });

  it('never mutates input geometry', () => {
    const rect = Object.freeze({ left: 50, top: 100, width: 150, height: 36 });
    expect(
      validationOverlayLayout(rect, Object.freeze(viewport), Object.freeze(insets)),
    ).not.toBeNull();
    expect(rect).toEqual({ left: 50, top: 100, width: 150, height: 36 });
  });

  it('keeps both controls bounded across desktop, zoomed, and mobile-sized shells', () => {
    for (const size of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
      { width: 100, height: 180 },
      { width: 64, height: 50 },
    ]) {
      for (const left of [-20, 0, 50, size.width - 60]) {
        for (const top of [-20, 0, 50, size.height - 60]) {
          const result = validationOverlayLayout({ left, top, width: 120.5, height: 60.5 }, size, {
            left: 20,
            top: 20,
          });
          if (!result) continue;
          const { trigger, picker } = result;
          expect(trigger.left).toBeGreaterThanOrEqual(20);
          expect(trigger.top).toBeGreaterThanOrEqual(20);
          expect(trigger.left + trigger.width).toBeLessThanOrEqual(size.width - 4);
          expect(trigger.top + trigger.height).toBeLessThanOrEqual(size.height - 4);
          expect(picker.left).toBeGreaterThanOrEqual(4);
          expect(picker.top).toBeGreaterThanOrEqual(4);
          expect(picker.left + picker.width).toBeLessThanOrEqual(size.width - 4);
          expect(picker.top + picker.maxHeight).toBeLessThanOrEqual(size.height - 4);
          expect(picker.width).toBeGreaterThan(0);
          expect(picker.maxHeight).toBeGreaterThan(0);
          expect(picker.maxHeight).toBeLessThanOrEqual(320);
        }
      }
    }
  });
});
