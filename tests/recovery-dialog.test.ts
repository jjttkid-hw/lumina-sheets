import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactNode, ReactElement } from 'react';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] = value;
      },
    ];
  },
}));
import RecoveryDialog from '../src/components/RecoveryDialog';
import { readRecoveryImport } from '../src/lib/recovery-import';
import { createBlankWorkbook } from '../src/lib/seed';
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});
function make() {
  const book = createBlankWorkbook('预算');
  const backup = readRecoveryImport({
    format: 'lumina-recovery',
    version: 1,
    records: [
      {
        workbook: book,
        revisions: [{ name: 'CHECKPOINT', createdAt: '2026-09-20', workbook: book }],
      },
    ],
  })!;
  const onRestore = vi.fn(),
    onClose = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return elements(RecoveryDialog({ backup, onRestore, onClose }));
  };
  const field = (label: string) => render().find((n) => n.props['aria-label'] === label)!;
  return {
    render,
    field,
    onRestore,
    onClose,
    change: (label: string, value: string) => field(label).props.onChange({ target: { value } }),
    submit: () =>
      render()
        .find((n) => n.type === 'form')!
        .props.onSubmit({ preventDefault() {} }),
  };
}
describe('recovery snapshot search and selection', () => {
  it('preserves original indexes and requires explicit selection when a filter hides the selected snapshot', () => {
    const view = make();
    view.change('搜索备份快照', ' checkpoint ');
    expect(view.field('待恢复工作簿').props.value).toBe('');
    expect(
      view
        .render()
        .filter((n) => n.type === 'option')
        .map((n) => n.props.value),
    ).toEqual(['', 1]);
    view.submit();
    expect(view.onRestore).not.toHaveBeenCalled();
    view.change('待恢复工作簿', '1');
    view.submit();
    expect(view.onRestore).toHaveBeenCalledExactlyOnceWith(1);
    view.change('搜索备份快照', '2026-09');
    expect(view.field('待恢复工作簿').props.value).toBe('1');
    view.change('搜索备份快照', '历史版本');
    expect(view.field('待恢复工作簿').props.value).toBe('1');
  });
  it('does not restore hidden snapshots, recovers after clearing search, and suppresses Enter/IME submission', () => {
    const view = make();
    view.change('搜索备份快照', '没有结果');
    expect(view.field('待恢复工作簿').props.disabled).toBe(true);
    expect(view.render().find((n) => n.props.type === 'submit')!.props.disabled).toBe(true);
    view.submit();
    expect(view.onRestore).not.toHaveBeenCalled();
    view.change('搜索备份快照', '');
    expect(view.field('待恢复工作簿').props.value).toBe('0');
    for (const event of [
      { key: 'Enter', keyCode: 13 },
      { key: 'Enter', keyCode: 229 },
    ]) {
      const preventDefault = vi.fn();
      view.field('搜索备份快照').props.onKeyDown({ ...event, preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
    expect(view.onRestore).not.toHaveBeenCalled();
    view.onRestore.mockImplementationOnce(() => {
      throw new Error('损坏快照');
    });
    view.submit();
    expect(view.render().find((n) => n.props.role === 'alert')!.props.children).toBe('损坏快照');
    view.change('待恢复工作簿', '1');
    expect(view.render().some((n) => n.props.role === 'alert')).toBe(false);
    view.submit();
    expect(view.onRestore).toHaveBeenLastCalledWith(1);
  });
});
