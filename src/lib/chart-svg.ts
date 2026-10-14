import { copyChartModel, type ChartModel } from './chart';

export interface ChartSvgOptions {
  /** Integer CSS pixels, 320–1920. */
  width?: number;
  /** Integer CSS pixels, 240–1080. */
  height?: number;
}
const colors = ['#23644d', '#315fa0', '#a64d26', '#7853a6', '#8b6518', '#087d86'];
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const number = (value: number) => Number(value.toFixed(3));
const label = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(value);

/** Standalone vector chart. Escapes all text; embeds no script, external resource or event handler. */
export function chartToSvg(input: ChartModel, options: ChartSvgOptions = {}): string {
  const model = copyChartModel(input);
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('图表绘制选项无效。');
  const width = options.width ?? 800,
    height = options.height ?? 420;
  if (
    !Number.isSafeInteger(width) ||
    width < 320 ||
    width > 1920 ||
    !Number.isSafeInteger(height) ||
    height < 240 ||
    height > 1080
  )
    throw new RangeError('图表尺寸必须为宽 320–1920、高 240–1080 的整数。');
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(model.title ?? '数据图表')}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<title>${escape(model.title ?? '数据图表')}</title>`,
    `<desc>${escape(model.categories.map((category, i) => `${category}: ${model.series.map((s) => `${s.title} ${s.values[i] === null ? '缺失' : s.values[i]}`).join(', ')}`).join('; '))}</desc>`,
    `<rect width="100%" height="100%" fill="white"/>`,
  ];
  const text = (x: number, y: number, value: string, anchor = 'start', color = '#374151') =>
    out.push(
      `<text x="${number(x)}" y="${number(y)}" text-anchor="${anchor}" fill="${color}" font-family="system-ui,sans-serif" font-size="12">${escape(value)}</text>`,
    );
  text(20, 25, model.title ?? '数据图表');
  if (!model.categories.length || !model.series.some((s) => s.values.some((v) => v !== null))) {
    text(width / 2, height / 2, '暂无可绘制数据', 'middle');
  } else if (model.type === 'pie') {
    const values = model.series[0].values;
    const max = Math.max(0, ...values.map((v) => v ?? 0));
    const total = values.reduce<number>((n, v) => n + (max ? (v ?? 0) / max : 0), 0);
    const r = Math.min(width * 0.24, (height - 110) / 2),
      cx = width / 2,
      cy = (height + 30) / 2;
    if (!total) text(cx, cy, '没有正数占比', 'middle');
    let angle = -Math.PI / 2;
    values.forEach((value, i) => {
      if (value === null || value <= 0 || !total) return;
      const span = (value / max / total) * Math.PI * 2;
      const color = colors[i % colors.length];
      if (span >= Math.PI * 2 - 1e-12)
        out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
      else {
        const end = angle + span;
        out.push(
          `<path d="M ${number(cx)} ${number(cy)} L ${number(cx + r * Math.cos(angle))} ${number(cy + r * Math.sin(angle))} A ${number(r)} ${number(r)} 0 ${span > Math.PI ? 1 : 0} 1 ${number(cx + r * Math.cos(end))} ${number(cy + r * Math.sin(end))} Z" fill="${color}" stroke="white"><title>${escape(model.categories[i])}: ${value}</title></path>`,
        );
      }
      angle += span;
    });
    text(width / 2, height - 12, `${model.series[0].title} · 精确值见数据表`, 'middle');
  } else {
    const left = 78,
      right = 22,
      top = 72,
      bottom = height - 60;
    const plot = width - left - right;
    const magnitude = Math.max(Math.abs(model.domain.min), Math.abs(model.domain.max), 1);
    const min = model.domain.min / magnitude,
      max = model.domain.max / magnitude;
    const span = max - min || 1;
    const y = (v: number) => bottom - ((v / magnitude - min) / span) * (bottom - top);
    const slot = plot / Math.max(model.categories.length, 1);
    const x = (i: number) => left + slot * (i + 0.5);
    for (let i = 0; i <= 4; i++) {
      const v = min + (span * i) / 4,
        py = bottom - ((bottom - top) * i) / 4;
      out.push(
        `<line x1="${left}" x2="${width - right}" y1="${number(py)}" y2="${number(py)}" stroke="#d1d5db"/>`,
      );
      text(left - 8, py + 4, label(v * magnitude), 'end');
    }
    model.series.forEach((series, si) => {
      const color = colors[si % colors.length];
      // Lines break at missing values instead of silently joining across a gap.
      let segment: string[] = [];
      const flush = () => {
        if (segment.length > 1)
          out.push(
            `<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="2" ${si >= colors.length ? 'stroke-dasharray="5 3"' : ''}/>`,
          );
        segment = [];
      };
      series.values.forEach((value, i) => {
        if (value === null) {
          flush();
          return;
        }
        if (model.type === 'line') {
          segment.push(`${number(x(i))},${number(y(value))}`);
          out.push(
            `<circle cx="${number(x(i))}" cy="${number(y(value))}" r="3" fill="${color}"><title>${escape(model.categories[i])} · ${escape(series.title)}: ${value}</title></circle>`,
          );
        } else {
          const bw = (slot * 0.8) / model.series.length,
            bx = x(i) - slot * 0.4 + si * bw;
          out.push(
            `<rect x="${number(bx)}" y="${number(Math.min(y(0), y(value)))}" width="${number(bw * 0.9)}" height="${number(Math.abs(y(value) - y(0)))}" fill="${color}"><title>${escape(model.categories[i])} · ${escape(series.title)}: ${value}</title></rect>`,
          );
        }
      });
      flush();
    });
    const every = Math.max(
      1,
      Math.ceil(model.categories.length / Math.max(2, Math.floor(plot / 90))),
    );
    model.categories.forEach((category, i) => {
      if (i % every === 0)
        text(
          x(i),
          bottom + 22,
          category.length > 10 ? category.slice(0, 10) + '…' : category,
          'middle',
        );
    });
    text(width / 2, height - 10, '精确值及系列名称见数据表', 'middle');
  }
  out.push('</svg>');
  return out.join('');
}
