/** Stop awaiting browser work while still consuming its eventual rejection. */
export function awaitFileOperation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new DOMException('文件操作已取消。', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (result) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
