import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { DataValidationRule } from '../src/lib/data-validation';
import type { Sheet } from '../src/lib/types';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
  deps: [] as Array<readonly unknown[]>,
  effectCursor: 0,
  effects: [] as Array<() => void>,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (index >= hooks.states.length)
        hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks.states[index],
        (value: unknown) => {
          hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value;
        },
      ];
    },
    useRef: (initial: unknown) => (hooks.refs[hooks.refCursor++] ??= { current: initial }),
    useId: () => 'validation-test',
    useEffect: (effect: () => void, dependencies: readonly unknown[]) => {
      const index = hooks.effectCursor++,
        previous = hooks.deps[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        hooks.deps[index] = dependencies;
        hooks.effects.push(effect);
      }
    },
  };
});
import ValidationDialog from '../src/components/ValidationDialog';
import type { ValidationDialogProps } from '../src/components/ValidationDialog';
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join('');
  if (isValidElement<Record<string, any>>(node)) return content(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
const rule = (id = 'existing'): DataValidationRule => ({
  id,
  kind: 'whole',
  operator: 'between',
  min: 1,
  max: 10,
  range: { start: { row: 1, col: 1 }, end: { row: 4, col: 1 } },
});
function make(rules: DataValidationRule[] = [], options: Partial<ValidationDialogProps> = {}) {
  const sheet: Sheet = {
    id: 'sheet',
    name: 'Data',
    rowCount: 20,
    colCount: 6,
    cells: { A1: { value: 'untouched' } },
    dataValidations: rules,
  };
  const onSave = vi.fn(),
    onClose = vi.fn(),
    focus = vi.fn(),
    scrollIntoView = vi.fn();
  const props: ValidationDialogProps = {
    sheet,
    selection: { row: 4, col: 2, endRow: 1, endCol: 1 },
    onSave,
    onClose,
    ...options,
  };
  const render = () => {
    hooks.cursor = hooks.refCursor = hooks.effectCursor = 0;
    const result = ValidationDialog(props);
    const error = elements(result).find((node) => node.props.role === 'alert');
    if (error) error.props.ref.current = { focus, scrollIntoView };
    for (const effect of hooks.effects.splice(0)) effect();
    return result;
  };
  const field = (label: string) => {
    const wrapper = elements(render()).find(
      (node) => node.type === 'label' && content(node).startsWith(label),
    );
    if (!wrapper) throw new Error(`Missing field: ${label}`);
    return elements(wrapper).find((node) =>
      ['input', 'select', 'textarea'].includes(String(node.type)),
    )!;
  };
  const click = (label: string) => {
    const node = elements(render()).find(
      (node) =>
        node.type === 'button' && (node.props['aria-label'] === label || content(node) === label),
    );
    if (!node) throw new Error(`Missing button: ${label}`);
    node.props.onClick();
  };
  const submit = () => {
    const preventDefault = vi.fn();
    elements(render())
      .find((node) => node.type === 'form')!
      .props.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  };
  return {
    render,
    field,
    click,
    submit,
    onSave,
    onClose,
    focus,
    scrollIntoView,
    sheet: props.sheet,
    change: (label: string, value: string | boolean) =>
      field(label).props.onChange({
        target: typeof value === 'boolean' ? { checked: value } : { value },
      }),
    error: () => content(elements(render()).find((node) => node.props.role === 'alert')),
  };
}
beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.deps = [];
  hooks.effects = [];
  hooks.cursor = hooks.refCursor = hooks.effectCursor = 0;
});

describe('ValidationDialog actual configuration handlers', () => {
  it('saves an empty collection when the initial new form is untouched', () => {
    const dialog = make();
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('preserves existing rules when a newly opened form is untouched', () => {
    const original = [rule()],
      dialog = make(original);
    dialog.click('新增规则');
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledExactlyOnceWith(original);
  });

  it('adds the unchanged default rule when explicitly added to the draft', () => {
    const dialog = make();
    dialog.click('添加到草稿');
    expect(dialog.onSave).not.toHaveBeenCalled();
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledExactlyOnceWith([
      {
        id: 'validation-1',
        kind: 'whole',
        operator: 'between',
        min: 0,
        max: 100,
        allowBlank: true,
        range: { start: { row: 1, col: 1 }, end: { row: 4, col: 2 } },
      },
    ]);
  });

  it('normalizes the selected range and saves the current form without requiring a separate draft click', () => {
    const dialog = make(),
      before = structuredClone(dialog.sheet);
    expect(dialog.field('应用范围').props.value).toBe('B2:C5');
    dialog.change('最小值', '2');
    dialog.change('最大值', '8');
    dialog.change('允许空白', false);
    dialog.change('输入错误提示', '填写2到8的整数');
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        kind: 'whole',
        min: 2,
        max: 8,
        allowBlank: false,
        message: '填写2到8的整数',
        range: { start: { row: 1, col: 1 }, end: { row: 4, col: 2 } },
      }),
    ]);
    expect(dialog.sheet).toEqual(before);
    expect(dialog.onClose).not.toHaveBeenCalled();
  });

  it('updates drafts and adds multiple rules without committing until final save', () => {
    const dialog = make([rule()]);
    dialog.change('最大值', '20');
    dialog.click('更新草稿');
    expect(dialog.onSave).not.toHaveBeenCalled();
    dialog.click('新增规则');
    dialog.change('允许内容', 'decimal');
    dialog.change('条件', 'greaterThan');
    dialog.change('比较值', '1.25');
    dialog.click('添加到草稿');
    expect(dialog.onSave).not.toHaveBeenCalled();
    dialog.submit();
    const saved = dialog.onSave.mock.calls[0][0];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: 'existing', max: 20 });
    expect(saved[1]).toMatchObject({ kind: 'decimal', operator: 'greaterThan', value: 1.25 });
    expect(saved[1].id).not.toBe(saved[0].id);
  });

  it('does not discard unfinished edits when switching rules or starting another rule', () => {
    const dialog = make([rule('one'), rule('two')]);
    dialog.change('最大值', '44');
    dialog.click('编辑规则 2 B2:B5');
    expect(dialog.error()).toContain('未更新的修改');
    expect(dialog.field('最大值').props.value).toBe('44');
    dialog.click('新增规则');
    expect(dialog.field('最大值').props.value).toBe('44');
    dialog.click('放弃修改');
    dialog.click('编辑规则 2 B2:B5');
    expect(dialog.field('最大值').props.value).toBe('10');
    dialog.change('最大值', '30');
    dialog.submit();
    expect(dialog.onSave.mock.calls[0][0].map((r: DataValidationRule) => r.id)).toEqual([
      'one',
      'two',
    ]);
    expect(dialog.onSave.mock.calls[0][0][1].max).toBe(30);
  });

  it('deletes only the draft and supports saving an empty rule collection', () => {
    const original = [rule()],
      dialog = make(original);
    dialog.click('删除此规则');
    expect(dialog.onSave).not.toHaveBeenCalled();
    expect(original).toHaveLength(1);
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('cancels all draft changes without mutating rules or cells', () => {
    const original = [rule()],
      dialog = make(original),
      before = structuredClone(dialog.sheet);
    dialog.change('最小值', '3');
    dialog.click('更新草稿');
    dialog.click('删除此规则');
    dialog.click('取消');
    expect(dialog.onClose).toHaveBeenCalledOnce();
    expect(dialog.onSave).not.toHaveBeenCalled();
    expect(dialog.sheet).toEqual(before);
  });

  it.each([
    ['应用范围', 'G1'],
    ['应用范围', 'A0'],
    ['最小值', ''],
    ['最大值', 'abc'],
    ['最小值', '1.5'],
    ['最小值', '200'],
    ['输入错误提示', 'x'.repeat(501)],
  ])('rejects invalid %s input and focuses the visible error', (label, value) => {
    const dialog = make();
    dialog.change(label, value);
    dialog.submit();
    expect(dialog.onSave).not.toHaveBeenCalled();
    expect(dialog.error()).not.toBe('');
    expect(dialog.focus).toHaveBeenCalledOnce();
    expect(dialog.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(dialog.field(label).props.value).toBe(value);
  });

  it('retains draft data when onSave rejects and lets the user correct and retry', () => {
    const dialog = make([rule()]);
    dialog.onSave.mockImplementationOnce((rules) => {
      rules[0].min = 999;
      throw new Error('保存暂时失败');
    });
    dialog.change('最小值', '4');
    dialog.submit();
    expect(dialog.error()).toBe('保存暂时失败');
    expect(dialog.field('最小值').props.value).toBe('4');
    expect(dialog.sheet.dataValidations?.[0]).toEqual(rule());
    dialog.change('最小值', '5');
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledTimes(2);
    expect(dialog.onSave.mock.calls[1][0][0].min).toBe(5);
    expect(dialog.error()).toBe('');
  });

  it('preserves imported mixed list types, empty strings and embedded newlines in JSON mode', () => {
    const imported: DataValidationRule = {
      id: 'typed',
      sheetId: 'sheet',
      kind: 'list',
      values: ['1', 1, true, false, '', 'line\nnext'],
      range: rule().range,
    };
    const dialog = make([imported]);
    expect(dialog.field('列表输入方式').props.value).toBe('json');
    expect(JSON.parse(dialog.field('允许的选项').props.value)).toEqual(imported.values);
    dialog.change('列表输入方式', 'text');
    expect(dialog.error()).toContain('无法无损');
    expect(dialog.field('列表输入方式').props.value).toBe('json');
    dialog.change('输入错误提示', '选择允许值');
    dialog.submit();
    expect(dialog.onSave.mock.calls[0][0][0]).toMatchObject({
      id: 'typed',
      sheetId: 'sheet',
      values: imported.values,
      message: '选择允许值',
    });
    expect(imported.message).toBeUndefined();
  });

  it('keeps numeric-looking entries as text in line mode and round-trips simple JSON strings', () => {
    const dialog = make();
    dialog.change('允许内容', 'list');
    dialog.change('允许的选项', '01\n  待办  \nTRUE');
    dialog.change('列表输入方式', 'json');
    expect(JSON.parse(dialog.field('允许的选项').props.value)).toEqual(['01', '  待办  ', 'TRUE']);
    dialog.change('列表输入方式', 'text');
    expect(dialog.field('允许的选项').props.value).toBe('01\n  待办  \nTRUE');
    dialog.submit();
    expect(dialog.onSave.mock.calls[0][0][0].values).toEqual(['01', '  待办  ', 'TRUE']);
  });

  it.each(['not json', '{}', '[]', '[null]', '[[1]]', '[{}]', '[1e999]'])(
    'rejects malformed or unsupported JSON list %s',
    (value) => {
      const dialog = make();
      dialog.change('允许内容', 'list');
      dialog.change('列表输入方式', 'json');
      dialog.change('允许的选项', value);
      dialog.submit();
      expect(dialog.error()).not.toBe('');
      expect(dialog.onSave).not.toHaveBeenCalled();
    },
  );

  it('preserves foreign-sheet rules as read-only while adding an independent current-sheet rule', () => {
    const imported: DataValidationRule = {
      ...rule('foreign'),
      sheetId: 'different',
      range: { start: { row: 100, col: 20 }, end: { row: 200, col: 40 } },
    };
    const dialog = make([imported]);
    expect(content(dialog.render())).toContain('只读保留');
    expect(elements(dialog.render()).find((node) => node.type === 'fieldset')?.props.disabled).toBe(
      true,
    );
    dialog.change('最大值', '999');
    expect(dialog.field('最大值').props.value).toBe('10');
    expect(
      elements(dialog.render()).some(
        (node) => node.type === 'button' && content(node) === '删除此规则',
      ),
    ).toBe(false);
    dialog.click('新增规则');
    dialog.change('最大值', '22');
    dialog.submit();
    expect(dialog.onSave.mock.calls[0][0][0]).toEqual(imported);
    expect(dialog.onSave.mock.calls[0][0][1].sheetId).toBeUndefined();
  });

  it('keeps an unchanged imported range beyond current sheet bounds, but validates a newly entered range', () => {
    const imported: DataValidationRule = {
      ...rule('extended'),
      sheetId: 'sheet',
      range: { start: { row: 100, col: 0 }, end: { row: 200, col: 0 } },
    };
    const dialog = make([imported]);
    dialog.submit();
    expect(dialog.onSave).toHaveBeenCalledExactlyOnceWith([imported]);
    dialog.onSave.mockClear();
    dialog.change('输入错误提示', '保留范围');
    dialog.submit();
    expect(dialog.onSave.mock.calls[0][0][0].range).toEqual(imported.range);
    dialog.onSave.mockClear();
    dialog.change('应用范围', 'A101:A202');
    dialog.submit();
    expect(dialog.onSave).not.toHaveBeenCalled();
    expect(dialog.error()).not.toBe('');
  });

  it('uses all eight operators and validates text-length thresholds as integer character counts', () => {
    const dialog = make();
    expect(elements(dialog.field('条件')).filter((node) => node.type === 'option')).toHaveLength(8);
    dialog.change('允许内容', 'textLength');
    dialog.change('条件', 'lessThanOrEqual');
    dialog.change('比较值', '5.5');
    dialog.submit();
    expect(dialog.onSave).not.toHaveBeenCalled();
    dialog.change('比较值', '5');
    dialog.submit();
    expect(dialog.onSave.mock.calls[0][0][0]).toMatchObject({
      kind: 'textLength',
      operator: 'lessThanOrEqual',
      value: 5,
    });
  });

  it('makes paged sheets view-only and never calls onSave even on a submit event', () => {
    const sheet: Sheet = {
      id: 'sheet',
      name: 'Read only',
      cells: {},
      rowCount: 20,
      colCount: 6,
      dataSource: { kind: 'paged' },
      dataValidations: [rule()],
    };
    const dialog = make([], { sheet });
    expect(content(dialog.render())).toContain('分页数据源只读');
    expect(
      elements(dialog.render()).find(
        (node) => node.type === 'button' && node.props.type === 'submit',
      )?.props.disabled,
    ).toBe(true);
    dialog.submit();
    expect(dialog.onSave).not.toHaveBeenCalled();
  });
});
