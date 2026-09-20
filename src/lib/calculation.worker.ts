import { calculateSync, type CalculationRequest, type CalculationMessage } from './calculation';

self.onmessage = (event: MessageEvent<CalculationRequest & { id: number }>) => {
  const request = event.data;
  try {
    const result = calculateSync(request);
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
