import { parseXlsxXml, xmlChildren, type XlsxArchive } from './xlsx-archive';

const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const objects: Record<string, string> = {
  drawing: '图片或图形',
  legacyDrawing: '批注或旧版图形',
  legacyDrawingHF: '页眉页脚图形',
  picture: '背景图片',
  oleObjects: '嵌入对象',
  controls: '表单控件',
  pivotTableParts: '数据透视表',
  pivotCaches: '数据透视缓存',
};

function unsupported(label: string, location: string): never {
  throw new Error(
    `XLSX：${location}包含尚不能保留的${label}，已停止导入以避免内容丢失。请保留原文件，在副本中移除这些对象后再导入。`,
  );
}

/** Reject known object losses before the downstream decoder discards their parts.
 * This is not a claim that every unsupported OOXML feature has been detected. */
export async function assertXlsxObjectsPreservable(archive: XlsxArchive): Promise<void> {
  for (const { xml, name } of [
    { xml: archive.workbook, name: '工作簿' },
    ...archive.sheets.map((sheet) => ({ xml: sheet.xml, name: `工作表「${sheet.name}」` })),
  ]) {
    for (const element of xmlChildren(xml)) {
      if (element.uri === MAIN && objects[element.name]) unsupported(objects[element.name], name);
    }
  }
  // All archive members were already bounded and decoded by readXlsxArchive.
  // Inspect declared types as well as visible references, so renamed parts or
  // unreferenced objects cannot silently disappear on a subsequent save.
  const part = archive.zip.file('[Content_Types].xml');
  if (!part) throw new Error('XLSX：缺少内容类型清单。');
  const manifest = parseXlsxXml(await part.async('string'));
  if (manifest.name !== 'Types' || manifest.uri !== TYPES)
    throw new Error('XLSX：内容类型清单无效。');
  for (const item of xmlChildren(manifest)) {
    if (item.uri !== TYPES || !['Default', 'Override'].includes(item.name)) continue;
    // Producers commonly declare defaults such as VML even with no such part.
    // A default describes an extension, not evidence that an object exists.
    if (
      item.name === 'Default' &&
      !Object.values(archive.zip.files).some(
        (file) =>
          !file.dir &&
          file.name.toLowerCase().endsWith(`.${(item.attributes.Extension ?? '').toLowerCase()}`),
      )
    )
      continue;
    const type = (item.attributes.ContentType ?? '').toLowerCase();
    let label: string | undefined;
    if (type.startsWith('image/')) label = '图片';
    else if (type.includes('drawingml.chart')) label = '图表';
    else if (type.includes('drawing') || type.includes('vmldrawing')) label = '图形';
    else if (type.includes('spreadsheetml.pivot')) label = '数据透视表或缓存';
    else if (type.includes('vbaproject') || type.includes('macroenabled')) label = '宏';
    else if (type.includes('oleobject') || type.includes('activex')) label = '嵌入对象或控件';
    if (label) unsupported(label, '文件');
  }
}
