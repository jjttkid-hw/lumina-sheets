import { useEffect, useRef, useState } from 'react';
import { productBuildIdentity } from '../lib/product-build';
import type { RangeBenchmarkReport } from '../lib/performance/range-benchmark';
import type { RangeBenchmarkResponse } from '../lib/performance/range-benchmark.worker';

export default function RangeBenchmark() {
  const [layout, setLayout] = useState<'disjoint' | 'overlapping'>('disjoint');
  const [result, setResult] = useState<RangeBenchmarkReport>();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('独立数据集：10,000 个范围公式，30 次输入修改。');
  const worker = useRef<Worker | undefined>(undefined);
  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = undefined;
    },
    [],
  );
  function start() {
    worker.current?.terminate();
    worker.current = undefined;
    setResult(undefined);
    setRunning(true);
    setStatus('正在准备数据与公式缓存…');
    try {
      const next = new Worker(
        new URL('../lib/performance/range-benchmark.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.current = next;
      next.onmessage = (event: MessageEvent<RangeBenchmarkResponse>) => {
        if (worker.current !== next) return;
        const message = event.data;
        if (message.type === 'progress')
          setStatus(`已完成 ${message.completed} / ${message.total} 次修改与结果校验`);
        else {
          if (message.type === 'result') {
            setResult(message.report);
            setStatus(`${message.report.iterations} 次计算结果均与全量重算一致，原始样本可导出。`);
          } else setStatus(message.message);
          next.terminate();
          worker.current = undefined;
          setRunning(false);
        }
      };
      next.onerror = () => {
        if (worker.current === next) {
          setStatus('范围基准运行失败，请重新运行。');
          next.terminate();
          worker.current = undefined;
          setRunning(false);
        }
      };
      next.postMessage({ layout });
    } catch (error) {
      worker.current?.terminate();
      worker.current = undefined;
      setRunning(false);
      setStatus(`范围基准运行失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function stop() {
    worker.current?.terminate();
    worker.current = undefined;
    setRunning(false);
    setStatus('采样已取消，未生成完成报告。');
  }
  function download() {
    if (!result) return;
    const data = {
      ...result,
      schema: 1,
      build: productBuildIdentity(),
      environment: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
      },
      notes: [
        '计时在独立 Worker 内；不含 Canvas、消息往返与文件导入。',
        `增量读取与全量重算都读取全部 ${result.formulaCount} 个公式；基线为同一引擎清空结果缓存后重算，不是第三方产品。`,
        `每轮先增量后全量，顺序固定，未随机化；${result.iterations} 次来自同一数据集，不代表跨设备 SLA。`,
        '每次修改后校验精确总和；索引访问数与候选检查数为实际计数。',
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `lumina-ranges-${result.layout}-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="performance-range-panel">
      <summary>范围公式更新基准</summary>
      <div className="performance-lab-controls">
        <label>
          公式分布{' '}
          <select
            aria-label="公式分布"
            disabled={running}
            value={layout}
            onChange={(e) => {
              setLayout(e.target.value as typeof layout);
              setResult(undefined);
              setStatus('公式分布已更改，请重新运行范围基准。');
            }}
          >
            <option value="disjoint">10,000 个独立范围</option>
            <option value="overlapping">10,000 个重叠范围</option>
          </select>
        </label>
        <button onClick={running ? stop : start}>
          {running ? '取消范围基准' : '运行范围基准'}
        </button>
        <button onClick={download} disabled={!result || running}>
          导出范围报告
        </button>
      </div>
      <p role="status">{status}</p>
      {result && (
        <div className="performance-range-results">
          <span>
            依赖失效 P95 <b>{result.summary.invalidationP95Ms.toFixed(2)} ms</b>
          </span>
          <span>
            增量读取 P95 <b>{result.summary.incrementalReadP95Ms.toFixed(2)} ms</b>
          </span>
          <span>
            全量重算 P95 <b>{result.summary.fullRecalculationP95Ms.toFixed(2)} ms</b>
          </span>
          <span>
            平均实际重算{' '}
            <b>
              {result.summary.meanRecomputedFormulas.toLocaleString()} /{' '}
              {result.formulaCount.toLocaleString()}
            </b>
          </span>
          <span>
            平均索引访问 <b>{result.summary.meanIndexVisits.toFixed(1)} 个节点</b>
          </span>
          <span>
            平均范围检查 <b>{result.summary.meanCandidateChecks.toFixed(1)} 个候选</b>
          </span>
        </div>
      )}
      <p className="performance-range-note">
        Worker
        内比较同一引擎增量更新与清空缓存后的全量重算。密集重叠时全部公式都需要重算；这些耗时不代表
        Canvas 帧率或其他产品性能。
      </p>
    </details>
  );
}
