import { describe, expect, it, vi } from 'vitest';
import { awaitFileOperation } from '../src/lib/file-operation';

describe('file operation cancellation', () => {
  it('rejects already cancelled work and consumes its late failure', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      awaitFileOperation(Promise.reject(Error('late')), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['success', 'failure', 'cancel'] as const)('removes the listener on %s', async (kind) => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let resolve!: (value: number) => void, reject!: (error: Error) => void;
    const work = new Promise<number>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const result = awaitFileOperation(work, controller.signal).catch((error) => error);
    if (kind === 'success') resolve(7);
    else if (kind === 'failure') reject(Error('read failed'));
    else controller.abort();
    const outcome = await result;
    if (kind === 'success') expect(outcome).toBe(7);
    else expect(outcome).toBeInstanceOf(Error);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    resolve(9);
    remove.mockRestore();
  });
});
