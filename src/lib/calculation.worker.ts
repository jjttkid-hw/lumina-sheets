import { calculateSync, type CalculationRequest, type CalculationMessage } from './calculation';
import type { CalculationTransfer } from './calculation-transfer';
import { CalculationSession } from './calculation-session';
const session = new CalculationSession();

self.onmessage = (
  event: MessageEvent<(CalculationRequest & { id: number }) | CalculationTransfer>,
) => {
  const request = event.data;
  try {
    const result =
      request.type === 'calculate-sheets' ? session.calculate(request) : calculateSync(request);
    (self as unknown as { postMessage: (message: unknown) => void }).postMessage({
      ...result,
      id: request.id,
    });
  } catch (error) {
    const response: CalculationMessage & { id: number } = {
      type: 'error',
      revision: request.revision,
      message: error instanceof Error ? error.message : String(error),
      id: request.id,
    };
    (self as unknown as { postMessage: (message: unknown) => void }).postMessage(response);
  }
};
