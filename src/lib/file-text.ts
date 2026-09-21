import { awaitFileOperation } from './file-operation';

/** Callers enforce their file-size limit before reading. Never replace damaged bytes. */
export async function readUtf8File(file: File, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  // Keep I/O failures outside the decoding catch so callers retain their cause.
  const work = file.arrayBuffer();
  const bytes = await (signal ? awaitFileOperation(work, signal) : work);
  signal?.throwIfAborted();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  const view = new Uint8Array(bytes);
  const chunkSize = 256 * 1024;
  const decode = (input?: Uint8Array, stream = false) => {
    try {
      return decoder.decode(input, { stream });
    } catch {
      throw new Error('文件包含无效的 UTF-8 编码，请将原文件转换为 UTF-8 后重试。');
    }
  };
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    signal?.throwIfAborted();
    chunks.push(decode(view.subarray(offset, offset + chunkSize), true));
    if (offset + chunkSize < view.length) {
      const turn = new Promise<void>((resolve) => setTimeout(resolve, 0));
      await (signal ? awaitFileOperation(turn, signal) : turn);
    }
  }
  signal?.throwIfAborted();
  chunks.push(decode());
  signal?.throwIfAborted();
  return chunks.join('');
}
