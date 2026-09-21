import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
const backup = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/recovery-backup', () => ({ collectRecoveryBackup: backup }));
vi.mock('../src/lib/persistence', () => ({ getPersistence: () => ({}) }));
import ErrorBoundary from '../src/components/ErrorBoundary';
function buttons(node: ReactNode): Array<{ props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [...(node.type === 'button' ? [node] : []), ...buttons(node.props.children)];
}
function mount() {
  const boundary = new ErrorBoundary({ children: null });
  boundary.state.failed = true;
  boundary.setState = ((next: object) => {
    Object.assign(boundary.state, next);
  }) as typeof boundary.setState;
  const download = () => buttons(boundary.render()).at(-1)!.props.onClick() as Promise<void>;
  return { boundary, download };
}
beforeEach(() => {
  vi.useFakeTimers();
  backup.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('crash recovery download', () => {
  it('exports the recovery bundle, cleans the URL and announces partial results', async () => {
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const data = { complete: false, records: [], warnings: ['failed'] };
    backup.mockResolvedValue(data);
    const { boundary, download } = mount();
    await download();
    expect(JSON.parse(await (create.mock.calls[0][0] as Blob).text())).toEqual(data);
    expect(link.download).toBe('Lumina-恢复备份.json');
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(boundary.state.message).toContain('部分数据');
    expect(boundary.state.saving).toBe(false);
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledWith('blob:backup');
  });
  it('prevents duplicate downloads and discards results after unmount', async () => {
    let resolve!: (value: unknown) => void;
    backup.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const create = vi.spyOn(URL, 'createObjectURL');
    const { boundary, download } = mount();
    const first = download();
    await download();
    expect(backup).toHaveBeenCalledOnce();
    boundary.componentWillUnmount();
    resolve({ complete: true });
    await first;
    expect(create).not.toHaveBeenCalled();
  });
  it('shows failure and allows a later retry', async () => {
    backup.mockRejectedValue(new Error('no data'));
    const { boundary, download } = mount();
    await download();
    expect(boundary.state.message).toContain('备份生成失败');
    expect(boundary.state.saving).toBe(false);
    await download();
    expect(backup).toHaveBeenCalledTimes(2);
  });
});
