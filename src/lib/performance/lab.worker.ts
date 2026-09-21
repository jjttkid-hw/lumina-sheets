import { cellKey } from '../engine';
import { createBlankWorkbook } from '../seed';
import { calculateSync } from '../calculation';
import type { Cell, Workbook } from '../types';

export type LabRequest =
  | { type: 'load'; storedCells: 100_000 | 1_000_000 }
  | { type: 'calculate'; id: number; targetCount: number }
  | { type: 'patch'; changes: Array<{ key: string; cell: Cell | null }> };

export type LabResponse =
  | { type: 'start'; workbook: Workbook; storedCells: number }
  | { type: 'chunk'; cells: Array<[string, Cell]>; loaded: number; total: number }
  | { type: 'ready'; generatedMs: number; storedCells: number; formulaCount: number }
  | {
      type: 'calculated';
      id: number;
      elapsedMs: number;
      targets: number;
      firstValue: unknown;
      lastValue: unknown;
    }
  | { type: 'error'; id?: number; message: string };

let workbook: Workbook | null = null;
let storedCount = 0;
const post = (response: LabResponse) => self.postMessage(response);

self.onmessage = (event: MessageEvent<LabRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      const started = performance.now();
      workbook = createBlankWorkbook('性能实测数据');
      const sheet = workbook.sheets[0];
      sheet.name = '性能实测';
      sheet.rowCount = 1_000_000;
      sheet.colCount = 256;
      sheet.frozenRows = 0;
      sheet.columnWidths = Object.fromEntries(Array.from({ length: 10 }, (_, col) => [col, 106]));
      storedCount = request.storedCells;
      post({
        type: 'start',
        workbook: { ...workbook, sheets: [{ ...sheet, cells: {} }] },
        storedCells: storedCount,
      });
      let loaded = 0;
      const generateChunk = () => {
        const stop = Math.min(storedCount, loaded + 5_000);
        const cells: Array<[string, Cell]> = [];
        for (; loaded < stop; loaded++) {
          const row = Math.floor(loaded / 10),
            col = loaded % 10;
          const key = cellKey(row, col);
          const cell: Cell = {
            value: col === 9 ? `=A${row + 1}+B${row + 1}*2` : (row + 1) * (col + 1),
          };
          sheet.cells[key] = cell;
          cells.push([key, cell]);
        }
        post({ type: 'chunk', cells, loaded, total: storedCount });
        if (loaded < storedCount) setTimeout(generateChunk, 0);
        else
          post({
            type: 'ready',
            generatedMs: performance.now() - started,
            storedCells: storedCount,
            formulaCount: storedCount / 10,
          });
      };
      generateChunk();
    } else if (request.type === 'patch' && workbook) {
      for (const change of request.changes) {
        if (change.cell === null) delete workbook.sheets[0].cells[change.key];
        else workbook.sheets[0].cells[change.key] = change.cell;
      }
    } else if (request.type === 'calculate' && workbook) {
      const count = Math.max(1, Math.min(storedCount / 10, request.targetCount));
      const sheet = workbook.sheets[0];
      const targets = Array.from({ length: count }, (_, row) => ({
        sheetId: sheet.id,
        key: cellKey(row, 9),
      }));
      const result = calculateSync({ type: 'calculate', workbook, targets, revision: request.id });
      post({
        type: 'calculated',
        id: request.id,
        elapsedMs: result.elapsedMs,
        targets: count,
        firstValue: result.values[`${sheet.id}:J1`],
        lastValue: result.values[`${sheet.id}:J${count}`],
      });
    }
  } catch (error) {
    post({
      type: 'error',
      ...(request.type === 'calculate' ? { id: request.id } : {}),
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
