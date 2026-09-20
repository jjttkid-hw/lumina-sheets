import { runRangeBenchmark, type RangeBenchmarkReport } from './range-benchmark';

export type RangeBenchmarkResponse =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; report: RangeBenchmarkReport }
  | { type: 'error'; message: string };
self.onmessage = async (event: MessageEvent<{ layout: 'disjoint' | 'overlapping' }>) => {
  const post = (message: RangeBenchmarkResponse) => self.postMessage(message);
  try {
    const report = await runRangeBenchmark({
      layout: event.data.layout,
      onProgress: (completed, total) => post({ type: 'progress', completed, total }),
    });
    post({ type: 'result', report });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
