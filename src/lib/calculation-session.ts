import { createEvaluator, type Evaluator } from './engine';
import type { Workbook, CellValue } from './types';
import type { CalculationResponse } from './calculation';
import { CalculationTransferReceiver, type CalculationTransfer } from './calculation-transfer';

/** One worker's private dependency cache; never shared with caller-owned snapshots. */
export class CalculationSession {
  private receiver = new CalculationTransferReceiver();
  private workbook?: Workbook;
  private evaluator?: Evaluator;
  private day?: string;

  get stats() {
    return this.evaluator?.stats;
  }

  calculate(message: CalculationTransfer): CalculationResponse {
    const started = performance.now();
    // A malformed message must not change the evaluator's workbook or graph.
    const request = this.receiver.receive(message);
    const next = request.workbook;
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const reset =
      !this.workbook ||
      !this.evaluator ||
      message.baseId === null ||
      this.workbook.id !== next.id ||
      message.sheets.length > 0 ||
      this.day !== day ||
      this.workbook.sheets.length !== next.sheets.length ||
      this.workbook.sheets.some((sheet, index) => sheet.id !== next.sheets[index].id);
    if (reset) {
      // Keep our own container because future receives must not mutate snapshots.
      this.workbook = { ...next, sheets: next.sheets };
      this.evaluator = createEvaluator(this.workbook, {
        managedMutations: true,
        revision: message.revision,
      });
    } else {
      this.evaluator!.resetStats();
      this.workbook!.sheets = next.sheets;
      for (const patch of message.sheetPatches ?? [])
        this.evaluator!.invalidateCells(
          patch.sheetId,
          patch.cells.map((cell) => cell.key),
          message.revision,
        );
    }
    this.day = day;
    const byId = new Map(this.workbook!.sheets.map((sheet) => [sheet.id, sheet]));
    const values: Record<string, CellValue> = {};
    for (const target of request.targets) {
      const sheet = byId.get(target.sheetId);
      values[`${target.sheetId}:${target.key}`] = sheet
        ? this.evaluator!(sheet, target.key)
        : '#REF!';
    }
    return {
      type: 'calculated',
      revision: message.revision,
      values,
      elapsedMs: Math.max(0, performance.now() - started),
    };
  }
}
