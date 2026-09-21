import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LabRequest, LabResponse } from '../src/lib/performance/lab.worker';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('performance laboratory worker', () => {
  it('streams the stated actual cell count and calculates real formulas on resident data', async () => {
    vi.useFakeTimers();
    const messages: LabResponse[] = [];
    const workerScope = {
      onmessage: (_event: MessageEvent<LabRequest>) => {},
      postMessage: (message: LabResponse) => messages.push(structuredClone(message)),
    };
    vi.stubGlobal('self', workerScope);
    await import('../src/lib/performance/lab.worker');
    const send = (data: LabRequest) => workerScope.onmessage({ data } as MessageEvent<LabRequest>);
    send({ type: 'load', storedCells: 100_000 });
    await vi.runAllTimersAsync();
    const start = messages.find((message) => message.type === 'start');
    expect(start?.type).toBe('start');
    if (start?.type === 'start') {
      expect(start.workbook.sheets[0].rowCount).toBe(1_000_000);
      expect(Object.keys(start.workbook.sheets[0].cells)).toHaveLength(0);
    }
    const chunks = messages.filter((message) => message.type === 'chunk');
    expect(chunks).toHaveLength(20);
    expect(chunks.reduce((total, message) => total + message.cells.length, 0)).toBe(100_000);
    expect(chunks.at(-1)?.loaded).toBe(100_000);
    expect(messages.at(-1)).toMatchObject({
      type: 'ready',
      storedCells: 100_000,
      formulaCount: 10_000,
    });
    send({ type: 'calculate', id: 1, targetCount: 10_000 });
    expect(messages.at(-1)).toMatchObject({
      type: 'calculated',
      id: 1,
      targets: 10_000,
      firstValue: 5,
      lastValue: 50_000,
    });
    send({
      type: 'calculate',
      id: 99,
      get targetCount(): number {
        throw Error('calculation failed');
      },
    });
    expect(messages.at(-1)).toEqual({ type: 'error', id: 99, message: 'calculation failed' });
    send({ type: 'patch', changes: [{ key: 'A1', cell: { value: 10 } }] });
    send({ type: 'calculate', id: 2, targetCount: 1 });
    expect(messages.at(-1)).toMatchObject({
      type: 'calculated',
      id: 2,
      targets: 1,
      firstValue: 14,
    });
  });
});
