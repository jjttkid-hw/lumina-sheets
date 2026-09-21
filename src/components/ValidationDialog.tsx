import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { copyDataValidationRules, DATA_VALIDATION_LIMITS } from '../lib/data-validation';
import type { DataValidationRule, ValidationOperator } from '../lib/data-validation';
import type { CellRange, CellValue, Selection, Sheet } from '../lib/types';
import { validationRangeLabel, parseValidationRange } from '../lib/workspace-validation';
import Modal from './Modal';
import '../styles/validation-dialog.css';

export interface ValidationDialogProps {
  sheet: Sheet;
  selection: Selection;
  onClose: () => void;
  onSave: (rules: DataValidationRule[]) => void;
}
interface RuleForm {
  range: string;
  kind: DataValidationRule['kind'];
  operator: ValidationOperator;
  min: string;
  max: string;
  value: string;
  allowBlank: boolean;
  message: string;
  listMode: 'text' | 'json';
  list: string;
}
const kinds = {
  whole: '整数',
  decimal: '小数（含整数）',
  textLength: '文本长度',
  list: '选项列表',
};
const operators: Record<ValidationOperator, string> = {
  between: '介于（含边界）',
  notBetween: '不介于（不含边界）',
  equal: '等于',
  notEqual: '不等于',
  greaterThan: '大于',
  greaterThanOrEqual: '大于或等于',
  lessThan: '小于',
  lessThanOrEqual: '小于或等于',
};
const simpleTextList = (values: unknown): values is string[] =>
  Array.isArray(values) &&
  values.every((value) => typeof value === 'string' && value !== '' && !/[\r\n]/.test(value));
function formFor(rule: DataValidationRule): RuleForm {
  const text = rule.kind === 'list' && simpleTextList(rule.values);
  return {
    range: validationRangeLabel(rule.range),
    kind: rule.kind,
    operator: rule.kind === 'list' ? 'between' : rule.operator,
    min: 'min' in rule ? String(rule.min) : '0',
    max: 'max' in rule ? String(rule.max) : '100',
    value: 'value' in rule ? String(rule.value) : '0',
    allowBlank: rule.allowBlank !== false,
    message: rule.message ?? '',
    listMode: text || rule.kind !== 'list' ? 'text' : 'json',
    list:
      rule.kind !== 'list'
        ? ''
        : text
          ? rule.values.join('\n')
          : JSON.stringify(rule.values, null, 2),
  };
}

export default function ValidationDialog({
  sheet,
  selection,
  onClose,
  onSave,
}: ValidationDialogProps) {
  const id = useId();
  const selectionRange: CellRange = {
    start: {
      row: Math.min(selection.row, selection.endRow ?? selection.row),
      col: Math.min(selection.col, selection.endCol ?? selection.col),
    },
    end: {
      row: Math.max(selection.row, selection.endRow ?? selection.row),
      col: Math.max(selection.col, selection.endCol ?? selection.col),
    },
  };
  const freshForm = () =>
    formFor({
      id: 'new',
      kind: 'whole',
      operator: 'between',
      min: 0,
      max: 100,
      range: selectionRange,
      allowBlank: true,
    });
  const [rules, setRules] = useState<DataValidationRule[]>(() =>
    structuredClone(sheet.dataValidations ?? []),
  );
  const [selected, setSelected] = useState<number | null>(() =>
    sheet.dataValidations?.length ? 0 : null,
  );
  const [form, setForm] = useState<RuleForm | null>(() =>
    sheet.dataValidations?.length ? formFor(sheet.dataValidations[0]) : freshForm(),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [error]);
  const original = selected === null ? undefined : rules[selected];
  const foreign = original?.sheetId !== undefined && original.sheetId !== sheet.id;
  const paged = sheet.dataSource?.kind === 'paged';
  const readOnly = foreign || paged;
  const fail = (cause: unknown) =>
    setError({
      message: cause instanceof Error ? cause.message : '规则未能保存，请检查配置后重试。',
    });
  const change = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
    if (!form || readOnly) return;
    setForm({ ...form, [key]: value });
    setDirty(true);
    setError(null);
    setNotice('');
  };
  const select = (index: number | null) => {
    if (dirty) {
      fail(new Error('当前规则还有未更新的修改，请先“更新草稿”或“放弃修改”，再选择另一条规则。'));
      return;
    }
    if (index === null && rules.length >= DATA_VALIDATION_LIMITS.rules) {
      fail(new Error('最多支持 1,000 条规则，请先删除不再使用的规则。'));
      return;
    }
    setSelected(index);
    setForm(index === null ? freshForm() : formFor(rules[index]));
    setError(null);
    setNotice('');
  };
  const number = (input: string, label: string) => {
    if (!input.trim() || !Number.isFinite(Number(input)))
      throw new Error(`${label}必须是有限数字。`);
    return Number(input);
  };
  const listValues = (current: RuleForm): CellValue[] => {
    if (current.listMode === 'json') {
      let values: unknown;
      try {
        values = JSON.parse(current.list);
      } catch {
        throw new Error('选项 JSON 格式不正确，请输入数组，例如 ["待办", 1, true]。');
      }
      if (!Array.isArray(values)) throw new Error('选项 JSON 必须是数组。');
      return values;
    }
    const values = current.list.split(/\r?\n/);
    if (!simpleTextList(values))
      throw new Error('逐行文本模式每行需要一个非空选项；空文本或含换行的选项请使用 JSON 模式。');
    return values;
  };
  const switchListMode = (mode: RuleForm['listMode']) => {
    if (!form || readOnly || mode === form.listMode) return;
    try {
      const values = form.list === '' && form.listMode === 'text' ? [] : listValues(form);
      if (mode === 'text' && !simpleTextList(values))
        throw new Error(
          '此列表含数字、布尔值、空文本或换行，无法无损转为逐行文本。请继续使用 JSON 模式。',
        );
      setForm({
        ...form,
        listMode: mode,
        list: mode === 'json' ? JSON.stringify(values, null, 2) : values.join('\n'),
      });
      setDirty(true);
      setError(null);
    } catch (cause) {
      fail(cause);
    }
  };
  const buildRule = (): DataValidationRule => {
    if (!form) throw new Error('请先新增或选择一条规则。');
    const range =
      original && form.range === validationRangeLabel(original.range)
        ? structuredClone(original.range)
        : parseValidationRange(form.range, sheet);
    let ruleId = original?.id;
    if (!ruleId) {
      let sequence = 1;
      while (rules.some((rule) => rule.id === `validation-${sequence}`)) sequence++;
      ruleId = `validation-${sequence}`;
    }
    const common = {
      id: ruleId,
      ...(original?.sheetId !== undefined ? { sheetId: original.sheetId } : {}),
      range,
      kind: form.kind,
      allowBlank: form.allowBlank,
      ...(form.message || original?.message !== undefined ? { message: form.message } : {}),
    };
    const candidate =
      form.kind === 'list'
        ? { ...common, values: listValues(form) }
        : form.operator === 'between' || form.operator === 'notBetween'
          ? {
              ...common,
              operator: form.operator,
              min: number(form.min, '最小值'),
              max: number(form.max, '最大值'),
            }
          : { ...common, operator: form.operator, value: number(form.value, '比较值') };
    return copyDataValidationRules([candidate])[0];
  };
  const proposedRules = (forceNew = false) => {
    if (!form || readOnly || (!dirty && !(forceNew && selected === null)))
      return structuredClone(rules);
    const rule = buildRule();
    return selected === null
      ? [...rules, rule]
      : rules.map((item, index) => (index === selected ? rule : item));
  };
  const updateDraft = () => {
    if (readOnly || !form) return;
    try {
      const next = proposedRules(true);
      copyDataValidationRules(next);
      const index = selected ?? next.length - 1;
      setRules(next);
      setSelected(index);
      setForm(formFor(next[index]));
      setDirty(false);
      setError(null);
      setNotice('已更新草稿。点击“保存规则”后对工作表生效。');
    } catch (cause) {
      fail(cause);
    }
  };
  const remove = () => {
    if (selected === null || readOnly) return;
    setRules(rules.filter((_, index) => index !== selected));
    setSelected(null);
    setForm(null);
    setDirty(false);
    setError(null);
    setNotice('已从草稿移除规则，保存后生效。');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (paged) return;
    try {
      const next = proposedRules();
      copyDataValidationRules(next);
      onSave(structuredClone(next));
      setError(null);
    } catch (cause) {
      fail(cause);
    }
  };

  return (
    <Modal title="数据验证" subtitle="为单元格设置允许输入的内容。" onClose={onClose} wide>
      <form className="validation-dialog" onSubmit={submit} noValidate>
        <p className="validation-dialog-info">
          保存规则不会改写已有数据，也不会检查所有已有值。后续编辑按规则验证；同一单元格的多条规则必须全部满足。
        </p>
        {paged && <p className="validation-dialog-readonly">分页数据源只读，当前只能查看规则。</p>}
        <div className="validation-dialog-layout">
          <aside className="validation-dialog-list" aria-label="规则草稿列表">
            <div className="validation-dialog-list-heading">
              <strong>规则草稿 · {rules.length}</strong>
              <button
                type="button"
                className="button small"
                onClick={() => select(null)}
                disabled={paged}
              >
                新增规则
              </button>
            </div>
            {rules.length ? (
              <ul>
                {rules.map((rule, index) => (
                  <li key={rule.id}>
                    <button
                      type="button"
                      className={`validation-dialog-rule ${index === selected ? 'selected' : ''}`}
                      aria-pressed={index === selected}
                      aria-label={`编辑规则 ${index + 1} ${validationRangeLabel(rule.range)}`}
                      onClick={() => select(index)}
                    >
                      <strong>{validationRangeLabel(rule.range)}</strong>
                      <span>
                        {kinds[rule.kind]}
                        {rule.sheetId !== undefined && rule.sheetId !== sheet.id
                          ? ' · 其他工作表 · 只读'
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="validation-dialog-hint">还没有规则。设置右侧内容，然后保存。</p>
            )}
          </aside>
          <section className="validation-dialog-editor" aria-label="规则配置">
            {form ? (
              <>
                <h3>
                  {selected === null ? '新增规则' : `规则 ${selected + 1}`}
                  {dirty ? ' · 尚未更新草稿' : ''}
                </h3>
                {foreign && (
                  <p className="validation-dialog-readonly">
                    此规则绑定其他工作表（{original?.sheetId}），在此只读保留，不会更改或删除。
                  </p>
                )}
                {original &&
                  (original.range.end.row >= sheet.rowCount ||
                    original.range.end.col >= sheet.colCount) &&
                  !foreign && (
                    <p className="validation-dialog-hint">
                      导入范围超出当前工作表。保持原范围可保留规则；修改范围时须位于当前工作表内。
                    </p>
                  )}
                <fieldset disabled={readOnly} className="validation-dialog-fields">
                  <label className="validation-dialog-field">
                    应用范围
                    <input
                      disabled={readOnly}
                      value={form.range}
                      placeholder="例如 B2:B100"
                      aria-describedby={`${id}-range`}
                      onChange={(event) => change('range', event.target.value)}
                    />
                  </label>
                  <p className="validation-dialog-hint" id={`${id}-range`}>
                    填写单元格或矩形范围，例如 A1、B2:D10；不包含工作表名称。
                  </p>
                  <label className="validation-dialog-field">
                    允许内容
                    <select
                      disabled={readOnly}
                      value={form.kind}
                      onChange={(event) => change('kind', event.target.value as RuleForm['kind'])}
                    >
                      {Object.entries(kinds).map(([value, title]) => (
                        <option key={value} value={value}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.kind === 'list' ? (
                    <>
                      <label className="validation-dialog-field">
                        列表输入方式
                        <select
                          disabled={readOnly}
                          value={form.listMode}
                          onChange={(event) =>
                            switchListMode(event.target.value as RuleForm['listMode'])
                          }
                        >
                          <option value="text">逐行文本 · 每行一个选项</option>
                          <option value="json">JSON 数组 · 保留值类型</option>
                        </select>
                      </label>
                      <label className="validation-dialog-field">
                        允许的选项
                        <textarea
                          disabled={readOnly}
                          rows={5}
                          spellCheck={false}
                          value={form.list}
                          aria-describedby={`${id}-list`}
                          placeholder={
                            form.listMode === 'text' ? '待办\n进行中\n已完成' : '["待办", 1, true]'
                          }
                          onChange={(event) => change('list', event.target.value)}
                        />
                      </label>
                      <p className="validation-dialog-hint" id={`${id}-list`}>
                        {form.listMode === 'text'
                          ? '每行均为文本，保留首尾空格；“1”不等于数字 1。数字、布尔值、空文本或含换行的值请使用 JSON 模式。'
                          : 'JSON 数组支持文本、数字和 true / false，可混合；不接受 null、对象或数组。文本需双引号，例如 ["1", 1, true]。'}
                        最多 1,000 个选项。
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="validation-dialog-field">
                        条件
                        <select
                          disabled={readOnly}
                          value={form.operator}
                          onChange={(event) =>
                            change('operator', event.target.value as ValidationOperator)
                          }
                        >
                          {Object.entries(operators).map(([value, title]) => (
                            <option key={value} value={value}>
                              {title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {form.operator === 'between' || form.operator === 'notBetween' ? (
                        <div className="validation-dialog-bounds">
                          <label className="validation-dialog-field">
                            最小值
                            <input
                              disabled={readOnly}
                              type="number"
                              step={form.kind === 'decimal' ? 'any' : '1'}
                              value={form.min}
                              onChange={(event) => change('min', event.target.value)}
                            />
                          </label>
                          <label className="validation-dialog-field">
                            最大值
                            <input
                              disabled={readOnly}
                              type="number"
                              step={form.kind === 'decimal' ? 'any' : '1'}
                              value={form.max}
                              onChange={(event) => change('max', event.target.value)}
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="validation-dialog-field">
                          比较值
                          <input
                            disabled={readOnly}
                            type="number"
                            step={form.kind === 'decimal' ? 'any' : '1'}
                            value={form.value}
                            onChange={(event) => change('value', event.target.value)}
                          />
                        </label>
                      )}
                      {form.kind === 'textLength' && (
                        <p className="validation-dialog-hint">
                          按 Unicode 码点计算文本长度，组合字符可能计为多个；范围为
                          0–32,767。数字和布尔值不视为文本。
                        </p>
                      )}
                    </>
                  )}
                  <label className="validation-dialog-checkbox">
                    <input
                      disabled={readOnly}
                      type="checkbox"
                      checked={form.allowBlank}
                      onChange={(event) => change('allowBlank', event.target.checked)}
                    />
                    允许空白
                  </label>
                  <label className="validation-dialog-field">
                    输入错误提示（可选）
                    <textarea
                      disabled={readOnly}
                      rows={2}
                      maxLength={500}
                      value={form.message}
                      onChange={(event) => change('message', event.target.value)}
                    />
                  </label>
                  <p className="validation-dialog-hint">
                    {form.message.length}/500 字符；留空时使用默认提示。
                  </p>
                </fieldset>
                {!readOnly && (
                  <div className="validation-dialog-draft-actions">
                    <button type="button" className="button" onClick={updateDraft}>
                      {selected === null ? '添加到草稿' : '更新草稿'}
                    </button>
                    {dirty && (
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setForm(original ? formFor(original) : freshForm());
                          setDirty(false);
                          setError(null);
                        }}
                      >
                        放弃修改
                      </button>
                    )}
                    {selected !== null && (
                      <button
                        type="button"
                        className="button validation-dialog-delete"
                        onClick={remove}
                      >
                        删除此规则
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="validation-dialog-info">
                选择一条规则继续编辑，或点击“新增规则”。保存将应用当前草稿列表。
              </p>
            )}
          </section>
        </div>
        {notice && (
          <p className="validation-dialog-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="validation-dialog-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error.message}
          </p>
        )}
        <div className="modal-footer validation-dialog-footer">
          <span>保存时会一并应用当前正在编辑的规则。</span>
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={paged}>
            保存规则
          </button>
        </div>
      </form>
    </Modal>
  );
}
