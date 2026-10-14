import { describe, expect, it } from 'vitest';
import { createChartModel, copyChartModel } from '../src/lib/chart';
import { chartToSvg } from '../src/lib/chart-svg';

describe('vector chart rendering', () => {
  function model(type: 'line' | 'bar' | 'pie' = 'line') {
    return createChartModel(
      { type, category: 'r', series: [{ field: 'v' }], title: '<script>alert(1)</script>' },
      [
        { r: 'a', v: 10 },
        { r: 'b', v: null },
        { r: 'c', v: 20 },
      ],
    );
  }
  it('escapes script-like labels and exports no executable or external resources', () => {
    const svg = chartToSvg(model());
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toMatch(/<script|onload=|href=|foreignObject/);
    expect(svg).toContain('<desc>');
  });
  it('breaks line segments at missing points', () => {
    expect(chartToSvg(model())).not.toContain('<polyline');
  });
  it('draws negative bars about zero and handles extreme finite domains', () => {
    const m = model('bar');
    m.series[0].values = [-Number.MAX_VALUE, 0, Number.MAX_VALUE];
    const svg = chartToSvg(m);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('<rect');
  });
  it('normalizes large pie values without overflow and renders a full-circle single slice', () => {
    const m = model('pie');
    m.series[0].values = [Number.MAX_VALUE, Number.MAX_VALUE, null];
    expect(chartToSvg(m)).not.toMatch(/NaN|Infinity/);
    m.series[0].values = [10, null, null];
    expect(chartToSvg(m)).toContain('<circle');
  });
  it('rejects malformed models before returning SVG and recomputes forged domains', () => {
    const m = model();
    m.domain = { min: 100, max: -100 };
    const copy = copyChartModel(m);
    expect(copy.domain).toEqual({ min: 0, max: 20 });
    copy.series[0].values[0] = 99;
    expect(m.series[0].values[0]).toBe(10);
    m.series[0].values.pop();
    expect(() => chartToSvg(m)).toThrow();
    expect(() => chartToSvg(model(), { width: 1 })).toThrow('尺寸');
  });
});
