import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Lightbulb,
  Sigma,
  Sparkles,
  X,
} from 'lucide-react';
import type { Workbook } from '../lib/types';
import { formatAmount, groupAnalytics, readWorkbookAnalytics } from './Analytics';
import '../styles/analytics.css';

export interface InsightsProps {
  workbook: Workbook;
  onClose: () => void;
  onApplyFormula?: (formula: string) => void;
}
const columnName = (column: number) => {
  let value = column + 1,
    name = '';
  while (value > 0) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};

export function Insights({ workbook, onClose, onApplyFormula }: InsightsProps) {
  const analysis = useMemo(() => readWorkbookAnalytics(workbook), [workbook]);
  const [prompt, setPrompt] = useState('');
  const [question, setQuestion] = useState('');
  const [inserted, setInserted] = useState(false);
  const revenue = analysis.rows.reduce((total, row) => total + row.revenue, 0);
  const profit = analysis.rows.reduce((total, row) => total + (row.profit ?? 0), 0);
  const months = groupAnalytics(analysis.rows, 'period');
  const products = groupAnalytics(analysis.rows, 'product').sort((a, b) => b.revenue - a.revenue);
  const bestMonth = [...months].sort((a, b) => b.revenue - a.revenue)[0];
  const lowestMargin = [...months]
    .filter((row) => row.revenue > 0)
    .sort((a, b) => a.profit / a.revenue - b.profit / b.revenue)[0];
  const prefix = analysis.financial ? '¥' : '';
  const revenueColumn = columnName(Math.max(0, analysis.revenueCol));
  const ranges: { first: number; last: number }[] = [];
  for (const row of analysis.rows) {
    const tail = ranges[ranges.length - 1];
    if (tail && tail.last === row.row) tail.last = row.row + 1;
    else ranges.push({ first: row.row + 1, last: row.row + 1 });
  }
  const source =
    analysis.sheet && analysis.sheet.id !== workbook.activeSheetId
      ? `'${analysis.sheet.name.replace(/'/g, "''")}'!`
      : '';
  const formulaRange = ranges
    .map((range) =>
      range.first === range.last
        ? `${source}${revenueColumn}${range.first}`
        : `${source}${revenueColumn}${range.first}:${revenueColumn}${range.last}`,
    )
    .join(',');
  const formula = `=SUM(${formulaRange || '0'})`;
  const margin = revenue
    ? `${formatAmount((profit / revenue) * 100, 1)}%`
    : '无法计算（总营收为 0）';
  const insight = analysis.rows.length
    ? analysis.hasProfit
      ? `综合利润率为 ${margin}，${bestMonth?.name}贡献了最高营收。`
      : `${bestMonth?.name}的${analysis.revenueLabel}最高，合计 ${prefix}${formatAmount(bestMonth?.revenue ?? 0)}。`
    : '填写数值后，这里会自动展示数据摘要。';
  const respond = (text: string) => {
    if (!analysis.rows.length)
      return '当前工作表还没有可分析的数值。请先添加标题行与数据，再尝试汇总或查看趋势。';
    if (/公式|sum|求和/i.test(text))
      return `汇总「${analysis.sheet?.name}」中的${analysis.revenueLabel}列，可使用 ${formula}。请插入数据区域外的空白单元格，避免循环引用。`;
    if (/利润率|毛利率/.test(text))
      return analysis.hasProfit
        ? `综合利润率 = 总利润 ÷ 总营收 = ${formatAmount(profit)} ÷ ${formatAmount(revenue)}，结果为 ${margin}。这是按金额加权的综合比率。`
        : '当前数据未识别出利润或成本列，暂时无法计算利润率。添加「利润」列，或同时提供「营收」与「成本」列后即可计算。';
    if (/最高|最好|月份|趋势/.test(text))
      return `在 ${months.length} 个期间中，${bestMonth?.name}的${analysis.revenueLabel}最高，合计 ${prefix}${formatAmount(bestMonth?.revenue ?? 0)}${revenue > 0 ? `，占总额 ${formatAmount(((bestMonth?.revenue ?? 0) / revenue) * 100, 1)}%` : ''}。${months.length > 1 ? '可在「数据分析」中查看完整期间趋势。' : '当前只有一个期间，尚不能比较期间变化。'}`;
    if (/产品|分类/.test(text))
      return (
        products.map((item) => `${item.name}：${prefix}${formatAmount(item.revenue)}`).join('；') +
        '。以上按数值从高到低排序。'
      );
    if (/汇总|营收|收入|合计|总额/.test(text))
      return `「${analysis.sheet?.name}」共 ${analysis.rows.length} 条有效记录，${analysis.revenueLabel}合计 ${prefix}${formatAmount(revenue)}。${analysis.hasProfit ? `总利润为 ¥${formatAmount(profit)}，综合利润率为 ${margin}。` : ''}`;
    if (/利润/.test(text))
      return analysis.hasProfit
        ? `总利润为 ¥${formatAmount(profit)}，综合利润率为 ${margin}。${lowestMargin ? `${lowestMargin.name}的利润率最低，为 ${formatAmount((lowestMargin.profit / lowestMargin.revenue) * 100, 1)}%。` : ''}`
        : '请在工作表中提供营收与成本数据，或添加利润列。';
    return '本地分析目前支持数值汇总、利润率、最高营收期间、产品分类与 SUM 公式。尚未连接大语言模型，暂时不能回答开放式问题。试试「汇总营收」或「哪个月份营收最高」。';
  };
  const runQuestion = (value: string) => {
    if (value.trim()) {
      setQuestion(value.trim());
      setPrompt('');
    }
  };
  return (
    <aside className="insights-panel" aria-label="数据洞察">
      <header className="insights-header">
        <div>
          <span className="insights-header-icon">
            <Sparkles size={17} />
          </span>
          <h2>数据洞察</h2>
        </div>
        <button className="insights-icon-button" onClick={onClose} aria-label="关闭数据洞察">
          <X size={17} />
        </button>
      </header>
      <div className="insights-scroll">
        <div className="insights-intro">
          <span className="insights-local-badge">
            <span />
            本地分析
          </span>
          <h3>数据里，藏着下一步。</h3>
          <p>基于当前工作簿，发现值得关注的业务信号。</p>
        </div>
        <section className="insights-overview">
          <div className="insights-section-label">
            <ChartNoAxesCombined size={15} />
            <span>工作簿速览</span>
          </div>
          <div className="insights-main-number">
            <span>{analysis.financial ? '总营收' : `${analysis.revenueLabel}合计`}</span>
            <strong>
              {prefix}
              {formatAmount(revenue)}
            </strong>
          </div>
          <div className="insights-mini-metrics">
            <div>
              <span>{analysis.hasProfit ? '综合利润率' : '有效记录'}</span>
              <strong>
                {analysis.hasProfit
                  ? revenue
                    ? `${formatAmount((profit / revenue) * 100, 1)}%`
                    : '—'
                  : analysis.rows.length}
              </strong>
            </div>
            <div>
              <span>{analysis.financial ? '产品线' : '数据分类'}</span>
              <strong>
                {products.length}
                <small> 个</small>
              </strong>
            </div>
          </div>
          <p className="insights-overview-caption">
            {analysis.sheet?.name ?? '当前工作表'} · {analysis.rows.length} 条记录
          </p>
        </section>
        <section className="insights-observation">
          <div className="insights-section-label">
            <Lightbulb size={15} />
            <span>值得关注</span>
          </div>
          <p>{insight}</p>
          {analysis.hasProfit && lowestMargin && (
            <div className="insights-suggestion">
              建议关注 {lowestMargin.name}的成本结构，该期间利润率为{' '}
              <strong>
                {formatAmount((lowestMargin.profit / lowestMargin.revenue) * 100, 1)}%
              </strong>
              ，是当前各期间的最低值。
            </div>
          )}
        </section>
        <section className="insights-questions">
          <h3>从一个问题开始</h3>
          {['帮我汇总营收', '哪个月份营收最高？', '计算综合利润率'].map((text) => (
            <button key={text} onClick={() => runQuestion(text)}>
              <span>{text}</span>
              <ArrowRight size={13} />
            </button>
          ))}
        </section>
        {question && (
          <section className="insights-answer" aria-live="polite">
            <div className="insights-question-echo">{question}</div>
            <div className="insights-answer-label">
              <Sparkles size={13} />
              分析结果
            </div>
            <p>{respond(question)}</p>
            <small>基于当前工作簿计算 · 数据修改后自动更新</small>
          </section>
        )}
        {analysis.rows.length > 0 && (
          <section className="insights-formula">
            <div className="insights-section-label">
              <Sigma size={15} />
              <span>让公式接手重复工作</span>
            </div>
            <p>一键汇总{analysis.revenueLabel}数据</p>
            <code>{formula}</code>
            {onApplyFormula && (
              <button
                onClick={() => {
                  onApplyFormula(formula);
                  setInserted(true);
                  window.setTimeout(() => setInserted(false), 1800);
                }}
              >
                {inserted ? (
                  <>
                    <Check size={14} />
                    已插入空白单元格
                  </>
                ) : (
                  <>
                    使用此公式
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
            )}
          </section>
        )}
      </div>
      <form
        className="insights-composer"
        onSubmit={(event) => {
          event.preventDefault();
          runQuestion(prompt);
        }}
      >
        <div className="insights-input-wrap">
          <textarea
            aria-label="输入数据分析问题"
            placeholder="问问你的数据…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                runQuestion(prompt);
              }
            }}
          />
          <button type="submit" disabled={!prompt.trim()} aria-label="分析问题">
            <ArrowUp size={16} />
          </button>
        </div>
        <p>
          <span />
          数据留在本机 · 基于规则计算
        </p>
      </form>
    </aside>
  );
}

export default Insights;
