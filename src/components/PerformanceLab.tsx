import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Download,
  Play,
  RotateCcw,
  Square,
  Zap,
} from 'lucide-react';
import Spreadsheet from './Spreadsheet';
import RangeBenchmark from './RangeBenchmark';
import { createEvaluator, parseCellKey } from '../lib/engine';
import { RenderMetricsCollector, sampleMemory } from '../lib/performance/harness';
import type { MemorySample, RenderMetricsSummary } from '../lib/performance/harness';
import type { LabRequest, LabResponse } from '../lib/performance/lab.worker';
import type { Cell, Selection, Sheet, Workbook } from '../lib/types';
import '../styles/performance-lab.css';
import { productBuildIdentity } from '../lib/product-build';

interface WorkerMeasurement {
  targets: number;
  roundTripMs: number;
  calculationMs: number;
  firstValue: unknown;
  lastValue: unknown;
}
interface FixtureMeasurement {
  storedCells: number;
  formulaCount: number;
  dataReadyMs: number;
  firstDrawMs?: number;
  generatedMs: number;
}
export interface PerformanceLabProps {
  onClose?: () => void;
}
const num = (value: number) => value.toLocaleString('zh-CN');
const ms = (value?: number) => (value === undefined ? '—' : `${value.toFixed(2)} ms`);

/** A disposable, local-only fixture using the product's actual Canvas spreadsheet. */
export default function PerformanceLab({ onClose }: PerformanceLabProps) {
  const [storedCells, setStoredCells] = useState<100_000 | 1_000_000>(100_000);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const workbookRef = useRef<Workbook | null>(null);
  const [selection, setSelection] = useState<Selection>({ row: 0, col: 0 });
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState('选择数据规模后加载实测数据');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fixture, setFixture] = useState<FixtureMeasurement | null>(null);
  const [workerResult, setWorkerResult] = useState<WorkerMeasurement | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RenderMetricsSummary | null>(null);
  const [editSummary, setEditSummary] = useState<RenderMetricsSummary | null>(null);
  const [memory, setMemory] = useState<MemorySample>({});
  const [pageInput, setPageInput] = useState('1');
  const workerRef = useRef<Worker | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const fixtureStart = useRef(0);
  const collector = useRef(new RenderMetricsCollector());
  const editCollector = useRef(new RenderMetricsCollector());
  const pendingEdit = useRef<{ started: number; sheet: Sheet; keys: string[] } | null>(null);
  const firstDraw = useRef<{ sheet: Sheet; started: number } | null>(null);
  const viewport = useRef<{
    firstRow: number;
    lastRow: number;
    firstCol: number;
    lastCol: number;
  } | null>(null);
  const scrollRun = useRef<{ row: number; step: number; next: () => void } | null>(null);
  const scrollProgress = useRef({ completed: 0, planned: 40, status: 'not-started' });
  const lastDraw = useRef<{ canvas: HTMLCanvasElement; count: string } | null>(null);
  const pendingCalculation = useRef<{ id: number; started: number } | null>(null);
  const calculationId = useRef(0);
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const evaluator = useMemo(() => (workbook ? createEvaluator(workbook) : null), [workbook]);
  const getValue = useCallback(
    (sheet: Sheet, key: string) => evaluator?.(sheet, key) ?? '',
    [evaluator],
  );
  function failWorker(message: string) {
    workerRef.current?.terminate();
    workerRef.current = null;
    pendingCalculation.current = null;
    setCalculating(false);
    setLoading(false);
    setWorkerResult(null);
    setStatus(`后台任务失败：${message}；请重新加载数据`);
  }
  const send = (request: LabRequest) => {
    try {
      if (!workerRef.current) throw new Error('后台任务不可用');
      workerRef.current.postMessage(request);
    } catch (error) {
      failWorker(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => {
      if (!mounted.current) return;
      setSummary(collector.current.summary());
      setEditSummary(editCollector.current.summary());
      setMemory(sampleMemory());
    }, 500);
    const stopWhenHidden = () => {
      if (document.hidden && scrollProgress.current.status === 'running') {
        if (runTimer.current) clearTimeout(runTimer.current);
        runTimer.current = null;
        scrollRun.current = null;
        scrollProgress.current.status = 'interrupted-background';
        setRunning(false);
        setStatus('页面进入后台，采样已中止；返回前台后请重新运行');
      }
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden);
      mounted.current = false;
      clearInterval(timer);
      if (runTimer.current) clearTimeout(runTimer.current);
      workerRef.current?.terminate();
    };
  }, []);

  const recordViewport = useCallback(
    (range: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }) => {
      viewport.current = range;
    },
    [],
  );
  const recordDraw = useCallback(
    (metrics: { drawMs: number; paintedCells: number; domNodes: number }) => {
      const canvas = gridRef.current?.querySelector('canvas');
      const count = canvas?.dataset.renderCount;
      if (
        canvas &&
        count &&
        lastDraw.current?.canvas === canvas &&
        lastDraw.current.count === count
      )
        return;
      if (canvas && count) lastDraw.current = { canvas, count };
      const at = performance.now();
      collector.current.record({
        durationMs: metrics.drawMs,
        paintedCells: metrics.paintedCells,
        domNodes: metrics.domNodes,
        timestamp: at,
      });
      const currentSheet = workbook?.sheets[0];
      const pendingFirstDraw = firstDraw.current;
      if (pendingFirstDraw && pendingFirstDraw.sheet === currentSheet) {
        const firstDrawMs = at - pendingFirstDraw.started;
        firstDraw.current = null;
        setFixture((current) => (current ? { ...current, firstDrawMs } : current));
      }
      const range = viewport.current;
      const edit = pendingEdit.current;
      if (edit && edit.sheet === currentSheet && range) {
        const hasVisibleEdit = edit.keys.some((key) => {
          const point = parseCellKey(key);
          return (
            point &&
            point.row >= range.firstRow &&
            point.row <= range.lastRow &&
            point.col >= range.firstCol &&
            point.col <= range.lastCol
          );
        });
        if (hasVisibleEdit)
          editCollector.current.record({
            durationMs: at - edit.started,
            paintedCells: metrics.paintedCells,
            domNodes: metrics.domNodes,
          });
        pendingEdit.current = null;
      }
      const run = scrollRun.current;
      if (
        run &&
        range &&
        selection.row === run.row &&
        range.firstRow <= run.row &&
        range.lastRow >= run.row
      ) {
        if (runTimer.current) clearTimeout(runTimer.current);
        scrollRun.current = null;
        scrollProgress.current.completed = run.step;
        if (run.step === scrollProgress.current.planned) {
          runTimer.current = null;
          scrollProgress.current.status = 'complete';
          setRunning(false);
          setStatus('40 个目标视区均已实际绘制，采样包含填充区与空白边界，可导出报告');
        } else runTimer.current = setTimeout(run.next, 110);
      }
    },
    [workbook, selection.row],
  );

  function resetMeasurements() {
    stopRun();
    scrollProgress.current = { completed: 0, planned: 40, status: 'not-started' };
    pendingCalculation.current = null;
    setCalculating(false);
    setStatus('样本已清空，可重新测量');
    collector.current.reset();
    editCollector.current.reset();
    pendingEdit.current = null;
    lastDraw.current = null;
    setSummary(null);
    setEditSummary(null);
    setWorkerResult(null);
  }
  function stopRun() {
    if (runTimer.current) clearTimeout(runTimer.current);
    runTimer.current = null;
    scrollRun.current = null;
    if (scrollProgress.current.status === 'running') scrollProgress.current.status = 'cancelled';
    setRunning(false);
  }
  function loadFixture() {
    stopRun();
    workerRef.current?.terminate();
    workerRef.current = null;
    resetMeasurements();
    setWorkbook(null);
    workbookRef.current = null;
    setLoading(true);
    setCalculating(false);
    setProgress(0);
    setFixture(null);
    firstDraw.current = null;
    viewport.current = null;
    scrollProgress.current = { completed: 0, planned: 40, status: 'not-started' };
    setStatus('正在后台生成并分批加载数据…');
    fixtureStart.current = performance.now();
    try {
      const worker = new Worker(new URL('../lib/performance/lab.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<LabResponse>) => {
        if (!mounted.current || workerRef.current !== worker) return;
        const message = event.data;
        if (message.type === 'start') workbookRef.current = message.workbook;
        else if (message.type === 'chunk') {
          const cells = workbookRef.current?.sheets[0].cells;
          if (cells) for (const [key, cell] of message.cells) cells[key] = cell;
          setProgress(message.loaded / message.total);
        } else if (message.type === 'ready') {
          const ready = workbookRef.current;
          if (!ready) return;
          setFixture({
            storedCells: message.storedCells,
            formulaCount: message.formulaCount,
            dataReadyMs: performance.now() - fixtureStart.current,
            generatedMs: message.generatedMs,
          });
          firstDraw.current = { sheet: ready.sheets[0], started: fixtureStart.current };
          setWorkbook(ready);
          setSelection({ row: 0, col: 0 });
          setPageInput('1');
          setLoading(false);
          setGeneration((value) => value + 1);
          setStatus(
            `已加载 ${num(message.storedCells)} 个实际单元格，含 ${num(message.formulaCount)} 个公式`,
          );
        } else if (message.type === 'calculated') {
          const request = pendingCalculation.current;
          if (!request || request.id !== message.id) return;
          setWorkerResult({
            targets: message.targets,
            roundTripMs: performance.now() - request.started,
            calculationMs: message.elapsedMs,
            firstValue: message.firstValue,
            lastValue: message.lastValue,
          });
          setCalculating(false);
          pendingCalculation.current = null;
          setStatus(`后台计算完成，返回 ${num(message.targets)} 个公式的汇总校验结果`);
        } else if (message.type === 'error') {
          if (message.id === undefined) {
            failWorker(message.message);
            return;
          }
          if (pendingCalculation.current?.id !== message.id) return;
          pendingCalculation.current = null;
          setWorkerResult(null);
          setLoading(false);
          setCalculating(false);
          setStatus(`运行失败：${message.message}`);
        }
      };
      worker.onerror = (event) => {
        if (!mounted.current || workerRef.current !== worker) return;
        failWorker(event.message || '通信失败');
      };
      worker.postMessage({ type: 'load', storedCells } satisfies LabRequest);
    } catch (error) {
      failWorker(error instanceof Error ? error.message : String(error));
    }
  }
  function patchCells(sheetId: string, changes: Array<{ key: string; cell: Cell | null }>) {
    const book = workbookRef.current;
    if (!book || sheetId !== book.sheets[0].id || changes.length > 100_000) return;
    const started = performance.now();
    const sheet = book.sheets[0];
    for (const change of changes) {
      if (change.cell === null) delete sheet.cells[change.key];
      else sheet.cells[change.key] = change.cell;
    }
    const next = { ...book, sheets: [{ ...sheet }] };
    pendingEdit.current = {
      started,
      sheet: next.sheets[0],
      keys: changes.map((change) => change.key),
    };
    workbookRef.current = next;
    setWorkbook(next);
    setGeneration((value) => value + 1);
    send({ type: 'patch', changes });
  }
  function jumpTo(row: number) {
    const clamped = Number.isFinite(row) ? Math.max(0, Math.min(999_999, Math.floor(row))) : 0;
    setSelection({ row: clamped, col: 0 });
    setPageInput(String(clamped + 1));
  }
  function runScrollSample() {
    if (!workbook || running) return;
    if (document.hidden) {
      setStatus('请保持此页面在前台后再采样');
      return;
    }
    collector.current.reset();
    setSummary(null);
    setRunning(true);
    scrollProgress.current = { completed: 0, planned: 40, status: 'running' };
    setStatus('正在跨视区采样：24 个填充区位置与16 个全表位置（含空白区）');
    const populatedRows = (fixture?.storedCells ?? storedCells) / 10;
    let step = 0;
    const next = () => {
      if (!mounted.current) return;
      const row =
        step < 24
          ? Math.floor((step / 23) * (populatedRows - 1))
          : Math.floor(((step - 24) / 15) * 999_999);
      step++;
      scrollRun.current = { row, step, next };
      jumpTo(row);
      // A timer is only a timeout guard. A matching viewport paint advances the run.
      runTimer.current = setTimeout(() => {
        scrollRun.current = null;
        runTimer.current = null;
        scrollProgress.current.status = 'timed-out';
        setRunning(false);
        setStatus('等待目标视区绘制超时，采样未完成；保持页面前台后重试');
      }, 3000);
    };
    next();
  }
  function runCalculation() {
    if (!workbook || calculating || !workerRef.current) return;
    const id = ++calculationId.current;
    pendingCalculation.current = { id, started: performance.now() };
    setWorkerResult(null);
    setCalculating(true);
    setStatus('后台公式计算中，表格仍可滚动和编辑');
    send({
      type: 'calculate',
      id,
      targetCount: Math.min(fixture?.formulaCount ?? 10_000, 100_000),
    });
  }
  function exportReport() {
    const report = {
      schema: 1,
      build: productBuildIdentity(),
      product: 'Lumina JavaScript performance laboratory',
      measuredAt: new Date().toISOString(),
      qualification: '本机实测；未配置性能通过预算；不表示第三方性能或商业认证',
      environment: {
        userAgent: navigator.userAgent,
        viewport: { width: gridRef.current?.clientWidth, height: gridRef.current?.clientHeight },
        hardwareConcurrency: navigator.hardwareConcurrency,
        devicePixelRatio: window.devicePixelRatio,
        memory: sampleMemory(),
      },
      fixture: { ...fixture, logicalRows: 1_000_000, logicalColumns: 256, populatedColumns: 10 },
      canvas: {
        ...collector.current.summary(),
        samples: collector.current.values(),
        note: '实际Canvas绘制耗时，不等于整帧时间或FPS',
      },
      editToCanvas: { ...editCollector.current.summary(), samples: editCollector.current.values() },
      workerCalculation: workerResult,
      scrollSampling: {
        ...scrollProgress.current,
        scope:
          '24 populated-area targets and 16 whole-sheet targets including empty rows; summary covers retained draws, with observed/dropped counts',
      },
      notes: [
        '数据在专用Worker中生成，按5000个单元格分批进入主线程。',
        'dataReadyMs计时到数据准备完成；firstDrawMs计时到该数据首次Canvas绘制完成，两者均从点击加载开始。',
        '公式往返计时使用Worker驻留的同一份数据；初次数据准备与首次绘制耗时单独记录。',
        '编辑计时仅记录包含可见修改单元格的同一工作表版本；同一绘制前合并的多次提交只采集最后一次。',
        '跨视区样本包含填充区与空白百万行边界，且包含滚动过程中实际发生的中间绘制；不能当作全表密集数据性能。',
        '后台页面会中止自动采样；每个目标等待实际视区绘制，最后一个目标绘制后才完成。',
        'Worker内部计算与往返仅单次样本；不报告P95。',
        '绘制和编辑各保留最近10000条有效样本；超出部分计入droppedFrames，分位数仅针对保留样本。',
        '内存只采集浏览器公开的计数器，通常不包含Worker堆。',
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `lumina-performance-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('本机实测报告已导出');
  }
  const heap = memory.usedJsHeapSize ?? memory.heapUsed;
  return (
    <section className="performance-lab" aria-label="性能实验室">
      <header className="performance-lab-heading">
        <div className="performance-lab-title">
          <span className="performance-lab-mark">
            <Activity size={22} />
          </span>
          <div>
            <p>JAVASCRIPT · CANVAS · WEB WORKER</p>
            <h2>性能实验室</h2>
          </div>
        </div>
        <div className="performance-lab-heading-actions">
          <button onClick={exportReport} disabled={!fixture}>
            <Download size={15} />
            导出实测报告
          </button>
          {onClose && (
            <button onClick={onClose}>
              <ArrowLeft size={15} />
              返回工作台
            </button>
          )}
        </div>
      </header>
      <p className="performance-lab-intro">
        在当前浏览器运行真实表格。逻辑行数、实际数据量和视口绘制量分别记录，所有结果均来自本机测量。
      </p>
      <div className="performance-lab-controls">
        <label>
          实际存储单元格
          <select
            value={storedCells}
            disabled={loading}
            onChange={(event) => setStoredCells(Number(event.target.value) as 100_000 | 1_000_000)}
          >
            <option value={100_000}>100,000 个 · 10,000 行 × 10 列</option>
            <option value={1_000_000}>1,000,000 个 · 100,000 行 × 10 列</option>
          </select>
        </label>
        <button className="performance-lab-primary" onClick={loadFixture} disabled={loading}>
          <Play size={15} />
          {loading ? `加载 ${Math.round(progress * 100)}%` : '加载数据'}
        </button>
        <button
          onClick={runCalculation}
          disabled={!fixture || calculating || loading || !workerRef.current}
        >
          <Zap size={15} />
          {calculating ? '计算中…' : '测量后台公式'}
        </button>
        <button onClick={running ? stopRun : runScrollSample} disabled={!fixture || loading}>
          {running ? <Square size={15} /> : <Activity size={15} />}
          {running ? '停止采样' : '跨视区采样'}
        </button>
        <button onClick={resetMeasurements} disabled={loading}>
          <RotateCcw size={15} />
          清空样本
        </button>
      </div>
      <RangeBenchmark />
      <div className="performance-lab-metrics">
        <article>
          <span>逻辑行数 / 实际单元格</span>
          <strong>
            1,000,000 <small>行</small>
          </strong>
          <p>{fixture ? `${num(fixture.storedCells)} 个单元格已驻留` : '等待加载真实数据'}</p>
        </article>
        <article>
          <span>Canvas 绘制 P95</span>
          <strong>{summary?.frames ? ms(summary.p95Ms) : '—'}</strong>
          <p>
            {num(summary?.frames ?? 0)} 次保留绘制 · 每次约{' '}
            {Math.round(summary?.averagePaintedCells ?? 0)} 格
            {!!summary?.droppedFrames && ` · 已移除 ${num(summary.droppedFrames)} 条较早样本`}
          </p>
        </article>
        <article>
          <span>编辑到 Canvas P95</span>
          <strong>{editSummary?.frames ? ms(editSummary.p95Ms) : '—'}</strong>
          <p>
            {num(editSummary?.frames ?? 0)} 次保留编辑样本 · 双击单元格编辑
            {!!editSummary?.droppedFrames &&
              ` · 已移除 ${num(editSummary.droppedFrames)} 条较早样本`}
          </p>
        </article>
        <article>
          <span>后台计算往返 / 计算</span>
          <strong>{ms(workerResult?.roundTripMs)}</strong>
          <p>
            {workerResult
              ? `${num(workerResult.targets)} 个公式 · 计算 ${ms(workerResult.calculationMs)}`
              : '点击“测量后台公式”开始'}
          </p>
        </article>
      </div>
      <div className="performance-lab-detail">
        <span>
          数据准备：<b>{ms(fixture?.dataReadyMs)}</b>
        </span>
        <span>
          到首次 Canvas 绘制：<b>{ms(fixture?.firstDrawMs)}</b>
        </span>
        <span>
          可观察主线程堆：
          <b>{heap === undefined ? '当前浏览器未公开' : `${(heap / 1024 / 1024).toFixed(1)} MB`}</b>
        </span>
        <span>
          结果校验 J1：<b>{workerResult ? String(workerResult.firstValue) : '—'}</b>
        </span>
      </div>
      <div className="performance-lab-grid-toolbar">
        <span>性能实测 / 独立临时数据</span>
        <div>
          <button
            disabled={!fixture}
            onClick={() => jumpTo(selection.row - 1000)}
            aria-label="上一千行"
          >
            <ArrowLeft size={14} />
          </button>
          <label>
            跳至行
            <input
              type="number"
              min="1"
              max="1000000"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') jumpTo(Number(pageInput) - 1);
              }}
            />
          </label>
          <button disabled={!fixture} onClick={() => jumpTo(Number(pageInput) - 1)}>
            定位
          </button>
          <button
            disabled={!fixture}
            onClick={() => jumpTo(selection.row + 1000)}
            aria-label="下一千行"
          >
            <ArrowRight size={14} />
          </button>
          <button disabled={!fixture} onClick={() => jumpTo(999_999)}>
            第 1,000,000 行
          </button>
        </div>
      </div>
      <div className="performance-lab-grid" ref={gridRef}>
        {workbook ? (
          <Spreadsheet
            workbook={workbook}
            sheet={workbook.sheets[0]}
            selection={selection}
            onSelect={(next) => {
              setSelection(next);
              setPageInput(String(next.row + 1));
            }}
            onChange={(next) => {
              const book = { ...workbook, sheets: [next] };
              workbookRef.current = book;
              setWorkbook(book);
            }}
            onPatch={patchCells}
            getValue={getValue}
            calculationVersion={generation}
            onRenderMetrics={recordDraw}
            onViewportChange={recordViewport}
          />
        ) : (
          <div className="performance-lab-empty">
            <Activity size={36} />
            <strong>{loading ? '后台生成数据' : '让性能成为可验证的数字'}</strong>
            <p>
              {loading
                ? `${num(Math.round(progress * storedCells))} / ${num(storedCells)} 个单元格`
                : '选择 10 万或 100 万个实际单元格，开始测量。'}
            </p>
            {loading && <progress max="1" value={progress} />}
          </div>
        )}
      </div>
      <footer className="performance-lab-footer">
        <span role="status">{status}</span>
        <small>
          绘制样本包含填充区和空白边界，不代表 FPS。后台计时为单次结果；内存可能不包含 Worker。
        </small>
      </footer>
    </section>
  );
}
