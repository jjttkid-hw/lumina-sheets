import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createBlankWorkbook } from '../src/lib/seed';
import { applyXlsxPrintSettings, readXlsxPrintSettings } from '../src/lib/xlsx-print';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
  parseXlsxXml,
  assertExcelJsCompatiblePaths,
  type XlsxArchive,
} from '../src/lib/xlsx-archive';

async function fixture() {
  const source = createBlankWorkbook();
  const sheet = source.sheets[0];
  sheet.name = "客户'二部,报表";
  sheet.cells = { A1: { value: '标题' }, J60: { value: '末尾' } };
  sheet.rowCount = 60;
  sheet.colCount = 10;
  sheet.printSettings = {
    paperSize: 'A3',
    orientation: 'portrait',
    margins: { top: 18, right: 24, bottom: 30, left: 36 },
    repeatRows: 2,
    repeatColumns: 1,
    rowBreaks: [20, 40],
    columnBreaks: [4, 7],
  };
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet(sheet.name);
  ws.getCell('A1').value = '标题';
  ws.getCell('J60').value = '末尾';
  const archive = await readXlsxArchive((await book.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  return { source, sheet, archive };
}
function names(archive: XlsxArchive) {
  let node = xmlChild(archive.workbook, 'definedNames');
  if (!node) {
    node = xmlElement('definedNames');
    archive.workbook.children.push(node);
  }
  return node;
}

describe('XLSX persisted print subset', () => {
  it('round-trips real XLSX paper, margins, titles, row and column breaks', async () => {
    const { source, sheet, archive } = await fixture();
    applyXlsxPrintSettings(archive, source.sheets);
    const bytes = await writeXlsxArchive(archive);
    const loaded = await readXlsxArchive(bytes);
    expect(readXlsxPrintSettings(loaded).get(sheet.name)).toEqual(sheet.printSettings);
    const xml = loaded.sheets[0].xml;
    expect(
      xmlChildren(xmlChild(xml, 'rowBreaks')!, 'brk').map((node) => node.attributes.id),
    ).toEqual(['20', '40']);
    expect(
      xmlChildren(xmlChild(xml, 'colBreaks')!, 'brk').map((node) => node.attributes.id),
    ).toEqual(['4', '7']);
    // Produced XML also remains consumable by the existing engine; cells are untouched.
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(bytes);
    expect(excel.worksheets[0].getCell('J60').value).toBe('末尾');
    expect(excel.worksheets[0].pageSetup.paperSize).toBe(8);
    expect(excel.worksheets[0].pageSetup.printTitlesRow).toBe('1:2');
  });

  it.each(['A4', 'A3', 'Letter'] as const)('round-trips %s landscape', async (paperSize) => {
    const { source, sheet, archive } = await fixture();
    sheet.printSettings!.paperSize = paperSize;
    sheet.printSettings!.orientation = 'landscape';
    applyXlsxPrintSettings(archive, source.sheets);
    expect(
      readXlsxPrintSettings(await readXlsxArchive(await writeXlsxArchive(archive))).get(sheet.name),
    ).toEqual(sheet.printSettings);
  });

  it('resolves renamed worksheet parts through relationships instead of guessing sheet1', async () => {
    const { source, sheet, archive } = await fixture();
    const relPath = 'xl/_rels/workbook.xml.rels';
    const relationships = parseXlsxXml(await archive.zip.file(relPath)!.async('string'));
    const relation = xmlChildren(relationships).find((item) =>
      item.attributes.Type.endsWith('/worksheet'),
    )!;
    relation.attributes.Target = 'custom/reports/final.xml';
    const oldPath = archive.sheets[0].path;
    archive.zip.file(
      'xl/custom/reports/final.xml',
      await archive.zip.file(oldPath)!.async('string'),
    );
    archive.zip.remove(oldPath);
    const { serializeXml } = await import('../src/lib/xlsx-archive');
    archive.zip.file(relPath, serializeXml(relationships));
    const changed = await readXlsxArchive(await archive.zip.generateAsync({ type: 'arraybuffer' }));
    expect(changed.sheets[0].path).toBe('xl/custom/reports/final.xml');
    expect(() => assertExcelJsCompatiblePaths(changed)).toThrow('标准部件路径');
    applyXlsxPrintSettings(changed, source.sheets);
    expect(
      readXlsxPrintSettings(await readXlsxArchive(await writeXlsxArchive(changed))).get(sheet.name),
    ).toEqual(sheet.printSettings);
  });

  it('rejects merge conflicts on export and import', async () => {
    const { source, archive } = await fixture();
    archive.sheets[0].xml.children.push(
      xmlElement('mergeCells', { count: '1' }, [xmlElement('mergeCell', { ref: 'D19:F22' })]),
    );
    expect(() => applyXlsxPrintSettings(archive, source.sheets)).toThrow('手动分页跨越合并');
    const setup = xmlChild(archive.sheets[0].xml, 'pageSetup')!;
    setup.attributes.paperSize = '9';
    archive.sheets[0].xml.children.push(
      xmlElement('rowBreaks', { count: '1', manualBreakCount: '1' }, [
        xmlElement('brk', { id: '20', min: '0', max: '16383', man: '1' }),
      ]),
    );
    expect(() => readXlsxPrintSettings(archive)).toThrow('手动分页跨越合并');
  });

  it.each([
    [
      'unsupported paper',
      (a: XlsxArchive) => {
        xmlChild(a.sheets[0].xml, 'pageSetup')!.attributes.paperSize = '5';
      },
    ],
    [
      'scaling',
      (a: XlsxArchive) => {
        xmlChild(a.sheets[0].xml, 'pageSetup')!.attributes.scale = '80';
      },
    ],
    [
      'fit to page',
      (a: XlsxArchive) => {
        a.sheets[0].xml.children.push(
          xmlElement('sheetPr', {}, [xmlElement('pageSetUpPr', { fitToPage: '1' })]),
        );
      },
    ],
    [
      'print area',
      (a: XlsxArchive) => {
        names(a).children.push(
          xmlElement('definedName', { name: '_xlnm.Print_Area', localSheetId: '0' }, [
            "'客户''二部,报表'!$A$1:$C$8",
          ]),
        );
      },
    ],
    [
      'nonleading titles',
      (a: XlsxArchive) => {
        names(a).children.push(
          xmlElement('definedName', { name: '_xlnm.Print_Titles', localSheetId: '0' }, [
            "'客户''二部,报表'!$2:$3",
          ]),
        );
      },
    ],
    [
      'partial break',
      (a: XlsxArchive) => {
        a.sheets[0].xml.children.push(
          xmlElement('rowBreaks', { count: '1' }, [
            xmlElement('brk', { id: '3', min: '2', max: '8', man: '1' }),
          ]),
        );
      },
    ],
  ] as const)(
    'rejects unsupported %s without silently losing print semantics',
    async (_, mutate) => {
      const { archive } = await fixture();
      mutate(archive);
      expect(() => readXlsxPrintSettings(archive)).toThrow('XLSX 打印设置');
    },
  );
});

describe('XLSX archive preflight', () => {
  it('rejects DTD and malformed XML rather than interpreting untrusted entities', () => {
    expect(() =>
      parseXlsxXml('<!DOCTYPE worksheet [<!ENTITY x "value">]><worksheet>&x;</worksheet>'),
    ).toThrow('DTD');
    expect(() => parseXlsxXml('<a><b></a>')).toThrow('XML');
  });

  it.each(['External', 'escape'])('rejects %s worksheet relationships', async (kind) => {
    const { archive } = await fixture();
    const path = 'xl/_rels/workbook.xml.rels';
    const xml = parseXlsxXml(await archive.zip.file(path)!.async('string'));
    const item = xmlChildren(xml).find((child) => child.attributes.Type.endsWith('/worksheet'))!;
    if (kind === 'External') {
      item.attributes.TargetMode = 'External';
      item.attributes.Target = 'https://example.com/data.xml';
    } else item.attributes.Target = '../../../outside.xml';
    const { serializeXml } = await import('../src/lib/xlsx-archive');
    archive.zip.file(path, serializeXml(xml));
    await expect(
      readXlsxArchive(await archive.zip.generateAsync({ type: 'arraybuffer' })),
    ).rejects.toThrow('XLSX');
  });

  it('rejects a spoofed relationship attribute namespace', async () => {
    const { archive } = await fixture();
    const sheet = xmlChildren(xmlChild(archive.workbook, 'sheets')!, 'sheet')[0];
    sheet.attributes['evil:id'] = sheet.attributes['r:id'];
    delete sheet.attributes['r:id'];
    archive.workbook.attributes['xmlns:evil'] = 'https://example.com/wrong';
    await expect(readXlsxArchive(await writeXlsxArchive(archive))).rejects.toThrow(
      '工作表关系不存在',
    );
  });

  it('checks DTDs in styles and unused XML before handing bytes to ExcelJS', async () => {
    const { archive } = await fixture();
    archive.zip.file('xl/unused.xml', '<!DOCTYPE root><root/>');
    await expect(
      readXlsxArchive(await archive.zip.generateAsync({ type: 'arraybuffer' })),
    ).rejects.toThrow('DTD');
  });

  it('rejects declared XML decompression size before inflating a large member', async () => {
    const { archive } = await fixture();
    archive.zip.file('xl/oversized.xml', ' '.repeat(16 * 1024 * 1024 + 1));
    const compressed = await archive.zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    });
    expect(compressed.byteLength).toBeLessThan(100_000);
    await expect(readXlsxArchive(compressed)).rejects.toThrow('解压体积');
  });

  it('rejects sanitized ZIP path traversal names', async () => {
    const zip = new JSZip();
    zip.file('../outside.xml', '<a/>');
    await expect(readXlsxArchive(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      '路径',
    );
  });
});

it('does not materialize ExcelJS default print metadata as an explicit setting', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Plain').getCell('A1').value = 'x';
  const archive = await readXlsxArchive((await book.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  expect(readXlsxPrintSettings(archive).get('Plain')).toBeUndefined();
});
