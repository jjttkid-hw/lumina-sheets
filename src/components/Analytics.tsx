import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Download,
  Layers3,
  TrendingUp,
} from 'lucide-react';
import type { Sheet, Workbook } from '../lib/types';
import { cellKey, createEvaluator, parseCellKey } from '../lib/engine';
import { serializeCsv } from '../lib/io';
import '../styles/analytics.css';

export interface AnalyticsRow {
  row: number;
  period: string;
  product: string;
  revenue: number;
  cost: number | null;
  profit: number | null;
}
export interface AnalyticsGroup {
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  count: number;
}
export interface WorkbookAnalytics {
  sheet: Sheet | undefined;
  rows: AnalyticsRow[];
  periods: string[];
  financial: boolean;
  revenueLabel: string;
  revenueCol: number;
  hasCost: boolean;
  hasProfit: boolean;
  headerRow: number;
}

const sum = (rows: AnalyticsRow[], field: 'revenue' | 'cost' | 'profit') =>
  rows.reduce((total, row) => total + (row[field] ?? 0), 0);
export const formatAmount = (value: number, digits = 0) =>
  new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const compact = (value: number) =>
  Math.abs(value) >= 10000 ? `${formatAmount(value / 10000, 1)} 万` : formatAmount(value);

/** Headers are detected from the workbook; missing financial fields are never inferred as measured zeroes. */
export function readWorkbookAnalytics(workbook: Workbook): WorkbookAnalytics {
  const financialSheet =
    workbook.sheets.find((sheet) => sheet.name === '营收明细') ??
    workbook.sheets.find((sheet) =>
      Object.values(sheet.cells).some((cell) =>
        /^(营收|营业收入|销售额|收入)([（(]|$)/.test(String(cell.value)),
      ),
    );
  const sheet =
    financialSheet ??
    workbook.sheets.find((item) => item.id === workbook.activeSheetId) ??
    workbook.sheets[0];
  const empty: WorkbookAnalytics = {
    sheet,
    rows: [],
    periods: [],
    financial: false,
    revenueLabel: '数值',
    revenueCol: -1,
    hasCost: false,
    hasProfit: false,
    headerRow: 0,
  };
  if (!sheet) return empty;
  const evaluate = createEvaluator(workbook);
  const value = (row: number, col: number) => evaluate(sheet, cellKey(row, col));
  const asNumber = (row: number, col: number): number | null => {
    if (col < 0) return null;
    const raw = value(row, col);
    if (
      raw === '' ||
      raw === null ||
      raw === undefined ||
      typeof raw === 'boolean' ||
      (typeof raw === 'string' && !raw.trim())
    )
      return null;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,，¥￥\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  let headerRow = 0,
    maxScore = -1;
  for (let row = 0; row < Math.min(sheet.rowCount, 10); row++) {
    let score = 0;
    for (let col = 0; col < Math.min(sheet.colCount, 80); col++)
      if (/月份|营收|收入|成本|产品线|利润|日期/.test(String(value(row, col)))) score++;
    if (score > maxScore) {
      maxScore = score;
      headerRow = row;
    }
  }
  const headers = Array.from({ length: Math.min(sheet.colCount, 80) }, (_, col) =>
    String(value(headerRow, col) ?? ''),
  );
  let revenueCol = headers.findIndex((header) =>
    /^(营收|营业收入|销售额|收入)([（(]|$)/.test(header),
  );
  const financial = revenueCol >= 0;
  const costCol = headers.findIndex((header) => /成本/.test(header));
  const profitCol = headers.findIndex((header) => /利润/.test(header) && !/率/.test(header));
  const monthCol = headers.findIndex((header) => /月份|日期|期间/.test(header));
  const productCol = headers.findIndex((header) => /产品线|产品|分类|类别|项目/.test(header));
  if (revenueCol < 0)
    revenueCol = headers.findIndex((_, col) =>
      Array.from({ length: Math.min(Math.max(sheet.rowCount - headerRow - 1, 0), 20) }, (_, i) =>
        asNumber(i + headerRow + 1, col),
      ).some((item) => item !== null),
    );
  if (revenueCol < 0) return { ...empty, headerRow };
  const rows: AnalyticsRow[] = [];
  const populatedRows = [
    ...new Set(
      Object.keys(sheet.cells)
        .map((key) => parseCellKey(key)?.row)
        .filter((row): row is number => row !== undefined && row > headerRow),
    ),
  ].sort((a, b) => a - b);
  for (const row of populatedRows) {
    // Empty trailing rows are excluded. Totals must not be counted a second time.
    const leading = headers.map((_, col) => String(sheet.cells[cellKey(row, col)]?.value ?? ''));
    if (
      leading.some((label) =>
        /^(合计|总计|汇总|总营收|总收入|TOTAL|Grand Total)$/i.test(label.trim()),
      )
    )
      continue;
    const revenue = asNumber(row, revenueCol);
    if (revenue === null) continue;
    const cost = financial ? asNumber(row, costCol) : null;
    const actualProfit = financial ? asNumber(row, profitCol) : null;
    rows.push({
      row,
      period:
        monthCol >= 0 ? String(value(row, monthCol) || `第 ${row + 1} 行`) : `第 ${row + 1} 行`,
      product: productCol >= 0 ? String(value(row, productCol) || '未分类') : '全部数据',
      revenue,
      cost,
      profit: actualProfit ?? (cost !== null ? revenue - cost : null),
    });
  }
  return {
    sheet,
    rows,
    periods: [...new Set(rows.map((row) => row.period))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN', { numeric: true }),
    ),
    financial,
    revenueLabel: financial ? '营收' : headers[revenueCol] || '数值',
    revenueCol,
    hasCost: rows.length > 0 && rows.every((row) => row.cost !== null),
    hasProfit: rows.length > 0 && rows.every((row) => row.profit !== null),
    headerRow,
  };
}

export function groupAnalytics(
  rows: AnalyticsRow[],
  field: 'period' | 'product',
): AnalyticsGroup[] {
  const groups = new Map<string, AnalyticsGroup>();
  for (const row of rows) {
    const group = groups.get(row[field]) ?? {
      name: row[field],
      revenue: 0,
      cost: 0,
      profit: 0,
      count: 0,
    };
    group.revenue += row.revenue;
    group.cost += row.cost ?? 0;
    group.profit += row.profit ?? 0;
    group.count++;
    groups.set(row[field], group);
  }
  const values = [...groups.values()];
  return field === 'period'
    ? values.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    : values;
}

function TrendChart({
  data,
  hasCost,
  revenueLabel,
  financial,
}: {
  data: AnalyticsGroup[];
  hasCost: boolean;
  revenueLabel: string;
  financial: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!holder.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(entry.contentRect.width, 280)),
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [data]);
  const height = 256,
    left = width < 430 ? 48 : 56,
    right = 24,
    top = 24,
    bottom = 36;
  const allValues = data.flatMap((row) => (hasCost ? [row.revenue, row.cost] : [row.revenue]));
  const min = Math.min(0, ...allValues),
    rawMax = Math.max(1, ...allValues);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawMax - min, 1)));
  const max = Math.ceil(rawMax / (magnitude / 2)) * (magnitude / 2);
  const y = (value: number) =>
    height - bottom - ((value - min) / (max - min)) * (height - top - bottom);
  const x = (index: number) =>
    left +
    (data.length === 1
      ? (width - left - right) / 2
      : (index / Math.max(data.length - 1, 1)) * (width - left - right));
  const points = (key: 'revenue' | 'cost') =>
    data.map((row, index) => `${x(index)},${y(row[key])}`).join(' ');
  const tickStep = Math.max(1, Math.ceil(data.length / (width < 460 ? 4 : 8)));
  return (
    <div ref={holder} className="analytics-trend">
      <svg
        role="img"
        aria-label={`${revenueLabel}${hasCost ? '与成本' : ''}趋势；详细数据见下方汇总表`}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{revenueLabel}趋势</title>
        {[0, 1, 2, 3, 4].map((index) => {
          const amount = min + ((max - min) * index) / 4;
          return (
            <g key={index}>
              <line
                x1={left}
                x2={width - right}
                y1={y(amount)}
                y2={y(amount)}
                stroke="#e9ede9"
                strokeDasharray={index ? '3 4' : undefined}
              />
              <text x={left - 10} y={y(amount) + 4} textAnchor="end" fill="#748075" fontSize="10">
                {compact(amount)}
              </text>
            </g>
          );
        })}
        {data.length > 1 && (
          <polygon
            points={`${x(0)},${y(0)} ${points('revenue')} ${x(data.length - 1)},${y(0)}`}
            fill="#eef5ee"
          />
        )}
        {hasCost && (
          <polyline
            points={points('cost')}
            fill="none"
            stroke="#a9bcb0"
            strokeWidth="2"
            strokeDasharray="5 5"
            strokeLinejoin="round"
          />
        )}
        <polyline
          points={points('revenue')}
          fill="none"
          stroke="#357753"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {data.map((row, index) => (
          <g key={row.name}>
            {hasCost && (
              <rect x={x(index) - 3} y={y(row.cost) - 3} width="6" height="6" fill="#a9bcb0" />
            )}
            <circle
              cx={x(index)}
              cy={y(row.revenue)}
              r={active === index ? 5 : 3.5}
              fill="white"
              stroke="#357753"
              strokeWidth="2"
            />
            <circle
              cx={x(index)}
              cy={y(row.revenue)}
              r="15"
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${row.name}，${revenueLabel} ${formatAmount(row.revenue)}${hasCost ? `，成本 ${formatAmount(row.cost)}` : ''}`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActive(index);
                }
              }}
            />
            {(index % tickStep === 0 || index === data.length - 1) && (
              <text x={x(index)} y={height - 12} textAnchor="middle" fill="#748075" fontSize="11">
                {row.name.length > 10 ? row.name.slice(0, 10) : row.name}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="analytics-chart-detail" aria-live="polite">
        {active !== null && data[active] ? (
          <>
            <strong>{data[active].name}</strong>
            <span>
              {revenueLabel} {formatAmount(data[active].revenue)}
              {hasCost && ` · 成本 ${formatAmount(data[active].cost)}`}
            </span>
          </>
        ) : (
          <span>点击数据点查看详情{financial ? ' · 金额单位：元' : ''}</span>
        )}
      </div>
    </div>
  );
}

export function summaryCsv(groups: AnalyticsGroup[], analysis: WorkbookAnalytics): string {
  const columns = [
    '期间',
    analysis.revenueLabel,
    ...(analysis.hasCost ? ['成本'] : []),
    ...(analysis.hasProfit ? ['利润', '利润率'] : []),
    '记录数',
  ];
  const records = groups.map((row) => [
    row.name,
    row.revenue,
    ...(analysis.hasCost ? [row.cost] : []),
    ...(analysis.hasProfit
      ? [row.profit, row.revenue ? `${((row.profit / row.revenue) * 100).toFixed(2)}%` : '—']
      : []),
    row.count,
  ]);
  return serializeCsv([columns, ...records]);
}

function downloadSummary(groups: AnalyticsGroup[], analysis: WorkbookAnalytics) {
  const blob = new Blob([summaryCsv(groups, analysis)], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `${analysis.sheet?.name ?? '工作簿'}-分析汇总.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function Analytics({ workbook }: { workbook: Workbook }) {
  const analysis = useMemo(() => readWorkbookAnalytics(workbook), [workbook]);
  const [period, setPeriod] = useState('all');
  const currentPeriod = period === 'all' || analysis.periods.includes(period) ? period : 'all';
  const rows = useMemo(
    () =>
      currentPeriod === 'all'
        ? analysis.rows
        : analysis.rows.filter((row) => row.period === currentPeriod),
    [analysis, currentPeriod],
  );
  const groups = useMemo(() => groupAnalytics(rows, 'period'), [rows]);
  const products = useMemo(
    () => groupAnalytics(rows, 'product').sort((a, b) => b.revenue - a.revenue),
    [rows],
  );
  const revenue = sum(rows, 'revenue'),
    cost = sum(rows, 'cost'),
    profit = sum(rows, 'profit');
  const margin = revenue ? (profit / revenue) * 100 : null;
  const best = [...groups].sort((a, b) => b.revenue - a.revenue)[0];
  const maxProduct = Math.max(1, ...products.map((item) => Math.abs(item.revenue)));
  const prefix = analysis.financial ? '¥ ' : '';
  const cards = [
    {
      label: analysis.financial ? '总营收' : `${analysis.revenueLabel}合计`,
      value: `${prefix}${formatAmount(revenue)}`,
      note: `${rows.length} 条记录 · ${groups.length} 个期间`,
      icon: <TrendingUp size={17} />,
    },
    {
      label: analysis.hasProfit ? '总利润' : analysis.hasCost ? '总成本' : '平均值',
      value: `${prefix}${formatAmount(analysis.hasProfit ? profit : analysis.hasCost ? cost : rows.length ? revenue / rows.length : 0)}`,
      note: analysis.hasProfit
        ? '按当前数据汇总'
        : analysis.hasCost
          ? '按成本字段汇总'
          : `基于「${analysis.revenueLabel}」计算`,
      icon: <Layers3 size={17} />,
    },
    {
      label: analysis.hasProfit ? '综合利润率' : '最高值',
      value: analysis.hasProfit
        ? margin === null
          ? '—'
          : `${formatAmount(margin, 1)}%`
        : formatAmount(rows.length ? Math.max(...rows.map((row) => row.revenue)) : 0),
      note: analysis.hasProfit ? '总利润 ÷ 总营收' : '当前范围内的最大值',
      icon: <ChartNoAxesCombined size={17} />,
    },
  ];
  return (
    <main className="analytics-view">
      <div className="analytics-page-heading">
        <div>
          <div className="analytics-eyebrow">WORKBOOK ANALYTICS</div>
          <h1>让每一份数据，更有洞察</h1>
          <p>从表格到全局，实时掌握业务的每一个变化。</p>
        </div>
        <div className="analytics-toolbar">
          <label className="analytics-period">
            <CalendarDays size={15} />
            <select
              aria-label="分析期间"
              value={currentPeriod}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="all">全部期间</option>
              {analysis.periods.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button
            className="analytics-export"
            onClick={() => downloadSummary(groups, analysis)}
            disabled={!rows.length}
          >
            <Download size={15} />
            导出分析
          </button>
        </div>
      </div>
      {!rows.length ? (
        <div className="analytics-empty">
          <ChartNoAxesCombined size={32} />
          <h2>从第一组数据开始</h2>
          <p>
            在工作表中填写带标题的数值列，即可查看汇总与趋势。支持自动识别营收、成本和利润字段。
          </p>
          <span>数据来源：{analysis.sheet?.name ?? '空白工作簿'}</span>
        </div>
      ) : (
        <>
          <section className="analytics-kpis" aria-label="关键指标">
            {cards.map((card, index) => (
              <article
                className={`analytics-kpi ${index === 0 ? 'analytics-kpi-primary' : ''}`}
                key={card.label}
              >
                <div className="analytics-kpi-top">
                  <span>{card.label}</span>
                  <span className="analytics-kpi-icon">{card.icon}</span>
                </div>
                <strong>{card.value}</strong>
                <p>{card.note}</p>
              </article>
            ))}
          </section>
          <div className="analytics-chart-grid">
            <section className="analytics-card analytics-chart-card">
              <div className="analytics-card-heading">
                <div>
                  <h2>{analysis.hasCost ? '营收与成本趋势' : `${analysis.revenueLabel}趋势`}</h2>
                  <p>按期间汇总，发现数据的变化</p>
                </div>
                <div className="analytics-legend">
                  <span>
                    <i />
                    {analysis.revenueLabel}
                  </span>
                  {analysis.hasCost && (
                    <span>
                      <i className="analytics-legend-cost" />
                      成本
                    </span>
                  )}
                </div>
              </div>
              <TrendChart
                data={groups}
                hasCost={analysis.hasCost}
                revenueLabel={analysis.revenueLabel}
                financial={analysis.financial}
              />
            </section>
            <section className="analytics-card analytics-product-card">
              <div className="analytics-card-heading">
                <div>
                  <h2>{analysis.financial ? '产品线营收' : '分类汇总'}</h2>
                  <p>按{analysis.revenueLabel}从高到低排序</p>
                </div>
                <Layers3 size={17} />
              </div>
              <div className="analytics-product-list">
                {products.slice(0, 6).map((product, index) => (
                  <div className="analytics-product-row" key={product.name}>
                    <div>
                      <span>
                        <i>{String(index + 1).padStart(2, '0')}</i>
                        {product.name}
                      </span>
                      <strong>
                        {prefix}
                        {compact(product.revenue)}
                      </strong>
                    </div>
                    <div className="analytics-bar-track">
                      <div
                        style={{
                          width: `${(Math.abs(product.revenue) / maxProduct) * 100}%`,
                          background:
                            product.revenue < 0 ? '#bc705a' : index === 0 ? '#4a805e' : '#b6cbb6',
                        }}
                      />
                    </div>
                    <small>
                      {revenue
                        ? `占总${analysis.revenueLabel} ${formatAmount((product.revenue / revenue) * 100, 1)}%`
                        : `${product.count} 条记录`}
                    </small>
                  </div>
                ))}
              </div>
              {products.length > 6 && (
                <p className="analytics-caption">显示前 6 个分类，共 {products.length} 个</p>
              )}
              <div className="analytics-product-note">
                <ArrowUpRight size={16} />
                <span>
                  {products[0]?.name}的{analysis.revenueLabel}最高，合计 {prefix}
                  {formatAmount(products[0]?.revenue ?? 0)}。
                </span>
              </div>
            </section>
          </div>
          <section className="analytics-card analytics-summary">
            <div className="analytics-card-heading">
              <div>
                <h2>期间表现</h2>
                <p>
                  {best?.name}的{analysis.revenueLabel}最高，为 {prefix}
                  {formatAmount(best?.revenue ?? 0)}
                </p>
              </div>
              <span className="analytics-source-badge">
                <span />
                与工作表同步
              </span>
            </div>
            <div className="analytics-table-scroll">
              <table>
                <caption className="analytics-sr-only">
                  各期间的{analysis.revenueLabel}、成本及利润汇总
                </caption>
                <thead>
                  <tr>
                    <th scope="col">期间</th>
                    <th scope="col">
                      {analysis.revenueLabel}
                      {analysis.financial ? '（元）' : ''}
                    </th>
                    {analysis.hasCost && <th scope="col">成本（元）</th>}
                    {analysis.hasProfit && (
                      <>
                        <th scope="col">利润（元）</th>
                        <th scope="col">利润率</th>
                      </>
                    )}
                    <th scope="col">记录数</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.name}>
                      <th scope="row">{group.name}</th>
                      <td>{formatAmount(group.revenue)}</td>
                      {analysis.hasCost && <td>{formatAmount(group.cost)}</td>}
                      {analysis.hasProfit && (
                        <>
                          <td>{formatAmount(group.profit)}</td>
                          <td>
                            <span
                              className={`analytics-margin ${group.profit < 0 ? 'analytics-margin-negative' : ''}`}
                            >
                              {group.revenue
                                ? `${formatAmount((group.profit / group.revenue) * 100, 1)}%`
                                : '—'}
                            </span>
                          </td>
                        </>
                      )}
                      <td>{group.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              数据来源：{analysis.sheet?.name} · {rows.length} 条有效数值记录
              {!analysis.financial && ' · 当前为通用数值分析'}
            </footer>
          </section>
        </>
      )}
    </main>
  );
}

export default Analytics;
