import { describe, expect, it } from 'vitest';
import {
  CalculationTransferSender,
  CalculationTransferReceiver,
} from '../src/lib/calculation-transfer';
import { calculateSync, type CalculationRequest } from '../src/lib/calculation';
import { createBlankWorkbook } from '../src/lib/seed';

function setup() {
  const book = createBlankWorkbook();
  const input = book.sheets[0];
  input.name = 'Input';
  input.cells = { A1: { value: 3, style: { bold: true } } };
  const output = {
    ...input,
    id: 'output',
    name: 'Output',
    cells: { B1: { value: '=Input!A1*2' } },
  };
  book.sheets.push(output);
  const request: CalculationRequest = {
    type: 'calculate',
    workbook: book,
    revision: 1,
    targets: [{ sheetId: output.id, key: 'B1' }],
  };
  const sender = new CalculationTransferSender(),
    receiver = new CalculationTransferReceiver();
  const send = (req: CalculationRequest, id: number) => {
    const message = sender.prepare(req, id);
    const decoded = receiver.receive(structuredClone(message));
    sender.commit(req, id);
    return { message, decoded, value: calculateSync(decoded).values['output:B1'] };
  };
  return { book, request, sender, receiver, send };
}
describe('calculation value snapshot protocol', () => {
  it('preserves paging semantics instead of calculating partial cached cells as static data', () => {
    const { request, send } = setup();
    request.workbook.sheets[0].dataSource = { kind: 'paged', totalRows: 1000, pageSize: 32 };
    const first = send(request, 1);
    expect(first.message.sheets[0].dataSource).toEqual(request.workbook.sheets[0].dataSource);
    expect(first.message.sheets[0].dataSource).not.toBe(request.workbook.sheets[0].dataSource);
    expect(first.value).toBe('#N/A');
  });

  it('replaces calculation input on paging transitions even with unchanged cells', () => {
    const { request, send } = setup();
    expect(send(request, 1).value).toBe(6);
    const [input, output] = request.workbook.sheets;
    const paged: CalculationRequest = {
      ...request,
      revision: 2,
      workbook: {
        ...request.workbook,
        sheets: [{ ...input, dataSource: { kind: 'paged', totalRows: 1000 } }, output],
      },
    };
    const second = send(paged, 2);
    expect(second.message.sheets).toHaveLength(1);
    expect(second.value).toBe('#N/A');
    const resized: CalculationRequest = {
      ...paged,
      revision: 3,
      workbook: {
        ...paged.workbook,
        sheets: [
          { ...paged.workbook.sheets[0], dataSource: { kind: 'paged', totalRows: 0 } },
          output,
        ],
      },
    };
    expect(send(resized, 3).message.sheets[0].dataSource?.totalRows).toBe(0);
    const restored = send({ ...request, revision: 4 }, 4);
    expect(restored.message.sheets).toHaveLength(1);
    expect(restored.value).toBe(6);
  });

  it('reuses snapshots for equivalent data source metadata', () => {
    const { request, send } = setup();
    request.workbook.sheets[0].dataSource = { kind: 'paged', totalRows: 1000, pageSize: 32 };
    send(request, 1);
    const [input, output] = request.workbook.sheets;
    const next = {
      ...request,
      revision: 2,
      workbook: {
        ...request.workbook,
        sheets: [{ ...input, dataSource: { ...input.dataSource! } }, output],
      },
    };
    expect(send(next, 2).message.sheets).toEqual([]);
  });
  it('transfers only the changed sheet and keeps cross-sheet dependencies correct without style data', () => {
    const { request, send } = setup();
    const first = send(request, 1);
    expect(first.message.sheets[0].cells.A1).toEqual({ value: 3 });
    expect(first.value).toBe(6);
    const [input, output] = request.workbook.sheets;
    const next = {
      ...request,
      revision: 2,
      workbook: {
        ...request.workbook,
        sheets: [{ ...input, cells: { A1: { value: 9 } } }, output],
      },
    };
    const second = send(next, 2);
    expect(second.message.sheets).toEqual([]);
    expect(second.message.sheetPatches).toEqual([
      { sheetId: input.id, cells: [{ key: 'A1', cell: { value: 9 } }] },
    ]);
    expect(second.decoded.workbook.sheets[1]).toBe(first.decoded.workbook.sheets[1]);
    expect(second.value).toBe(18);
    expect(send(next, 3).message.sheets).toEqual([]);
  });
  it('does not enumerate unchanged sheet cells and omits non-calculation metadata', () => {
    const { request, send } = setup();
    const cells = request.workbook.sheets[0].cells;
    let reads = 0;
    request.workbook.sheets[0].cells = new Proxy(cells, {
      ownKeys(target) {
        reads++;
        return Reflect.ownKeys(target);
      },
    });
    send(request, 1);
    expect(reads).toBe(1);
    send({ ...request, revision: 2 }, 2);
    expect(reads).toBe(1);
  });
  it('handles deletion, reorder, rename and workbook switches', () => {
    const { request, send } = setup();
    send(request, 1);
    const [input, output] = request.workbook.sheets;
    const reordered = send(
      { ...request, workbook: { ...request.workbook, sheets: [output, input] } },
      2,
    );
    expect(reordered.message.sheets).toEqual([]);
    expect(reordered.value).toBe(6);
    const renamed = send(
      {
        ...request,
        workbook: { ...request.workbook, sheets: [{ ...input, name: 'Renamed' }, output] },
      },
      3,
    );
    expect(renamed.message.sheets).toHaveLength(1);
    expect(renamed.value).toBe('#REF!');
    const removed = send({ ...request, workbook: { ...request.workbook, sheets: [output] } }, 4);
    expect(removed.decoded.workbook.sheets).toHaveLength(1);
    expect(removed.value).toBe('#REF!');
    const switched = send({ ...request, workbook: { ...request.workbook, id: 'new' } }, 5);
    expect(switched.message.baseId).toBeNull();
    expect(switched.message.sheets).toHaveLength(2);
    expect(switched.value).toBe(6);
  });
  it('rejects invalid deltas atomically and accepts a fresh full snapshot', () => {
    const { request, sender, receiver, send } = setup();
    send(request, 1);
    const message = sender.prepare(request, 2);
    for (const invalid of [
      { ...message, baseId: 999 },
      { ...message, workbookId: 'foreign' },
      { ...message, sheetIds: ['missing'] },
      { ...message, sheetIds: ['output', 'output'] },
      { ...message, sheets: [request.workbook.sheets[0], request.workbook.sheets[0]] },
    ])
      expect(() => receiver.receive(invalid)).toThrow();
    expect(calculateSync(receiver.receive(message)).values['output:B1']).toBe(6);
    sender.reset();
    const full = sender.prepare(request, 3);
    expect(full.baseId).toBeNull();
    expect(calculateSync(receiver.receive(full)).values['output:B1']).toBe(6);
  });
  it('transfers one changed value in a 10000-cell sheet and keeps old snapshots isolated', () => {
    const { request, send } = setup();
    const sheet = request.workbook.sheets[0];
    sheet.rowCount = 10000;
    sheet.cells = Object.fromEntries(
      Array.from({ length: 10000 }, (_, i) => [`A${i + 1}`, { value: i }]),
    );
    const first = send(request, 1);
    const next = {
      ...request,
      workbook: {
        ...request.workbook,
        sheets: [
          { ...sheet, cells: { ...sheet.cells, A1: { value: 42 } } },
          request.workbook.sheets[1],
        ],
      },
    };
    const result = send(next, 2);
    expect(result.message.sheets).toEqual([]);
    expect(result.message.sheetPatches![0].cells).toHaveLength(1);
    expect(result.value).toBe(84);
    expect(first.decoded.workbook.sheets[0].cells.A1.value).toBe(0);
    expect(JSON.stringify(result.message).length).toBeLessThan(1000);
  });
  it('preserves blank insertion and deletion while ignoring style-only changes', () => {
    const { request, send } = setup();
    send(request, 1);
    const sheet = request.workbook.sheets[0];
    const next = {
      ...request,
      workbook: {
        ...request.workbook,
        sheets: [
          { ...sheet, cells: { A1: { value: 3, style: { italic: true } }, A2: { value: '' } } },
          request.workbook.sheets[1],
        ],
      },
    };
    const inserted = send(next, 2);
    expect(inserted.message.sheetPatches![0].cells).toEqual([{ key: 'A2', cell: { value: '' } }]);
    const removed = send(request, 3);
    expect(removed.message.sheetPatches![0].cells).toEqual([{ key: 'A2', cell: null }]);
    expect(removed.decoded.workbook.sheets[0].cells.A2).toBeUndefined();
  });
  it('falls back to a full sheet above 4096 changes', () => {
    const { request, send } = setup();
    const sheet = request.workbook.sheets[0];
    sheet.rowCount = 5000;
    send(request, 1);
    const next = {
      ...request,
      workbook: {
        ...request.workbook,
        sheets: [
          {
            ...sheet,
            cells: Object.fromEntries(
              Array.from({ length: 4097 }, (_, i) => [`A${i + 1}`, { value: 8 }]),
            ),
          },
          request.workbook.sheets[1],
        ],
      },
    };
    const result = send(next, 2);
    expect(result.message.sheets).toHaveLength(1);
    expect(result.message.sheetPatches).toBeUndefined();
    expect(result.value).toBe(16);
  });
  it('rejects malformed patches atomically without poisoning the base', () => {
    const { request, sender, receiver, send } = setup();
    send(request, 1);
    const message = sender.prepare(request, 2);
    const sheetId = request.workbook.sheets[0].id;
    for (const key of ['A0', 'a1', '$A$1', 'XFD1048576', '__proto__']) {
      expect(() =>
        receiver.receive({
          ...message,
          sheetPatches: [{ sheetId, cells: [{ key, cell: { value: 8 } }] }],
        }),
      ).toThrow();
    }
    const change = { key: 'A1', cell: { value: 8 } };
    expect(() =>
      receiver.receive({ ...message, sheetPatches: [{ sheetId, cells: [change, change] }] }),
    ).toThrow();
    expect(() =>
      receiver.receive({ ...message, sheetPatches: [{ sheetId: 'missing', cells: [] }] }),
    ).toThrow();
    expect(calculateSync(receiver.receive(message)).values['output:B1']).toBe(6);
  });
  it('does not advance the base when a prepared message was never posted', () => {
    const { request, sender, send } = setup();
    send(request, 1);
    sender.prepare(request, 2);
    expect(sender.prepare(request, 3).baseId).toBe(1);
  });
});
