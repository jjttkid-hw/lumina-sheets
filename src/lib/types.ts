import type { DataValidationRule } from './data-validation';

export type CellValue = string | number | boolean;
export type CellFormat = 'general' | 'number' | 'currency' | 'percent' | 'date';
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  format?: CellFormat;
  fontSize?: number;
}
export interface RichTextStyle extends Pick<
  CellStyle,
  'bold' | 'italic' | 'underline' | 'color' | 'fontSize'
> {
  fontFamily?: string;
  strike?: boolean;
  verticalAlign?: 'baseline' | 'superscript' | 'subscript';
  /** XLSX font classification, distinct from the font's typeface name. */
  fontFamilyClass?: number;
  /** XLSX charset code; text itself is always stored as Unicode. */
  charset?: number;
}
export interface RichTextRun {
  text: string;
  style?: RichTextStyle;
}
export interface Cell {
  value: CellValue;
  style?: CellStyle;
  /** Optional inline font runs for ordinary text cells. Concatenated text equals value. */
  richText?: RichTextRun[];
  /** Preserved link metadata; the renderer does not automatically navigate. */
  hyperlink?: { target: string; tooltip?: string };
}
export interface CellRange {
  start: { row: number; col: number };
  end: { row: number; col: number };
}
export interface PrintSettings {
  paperSize?: 'A4' | 'A3' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  /** PDF points: 72 points equal one inch. All four sides must be specified. */
  margins?: { top: number; right: number; bottom: number; left: number };
  /** Number of leading rows/columns repeated on every printed page. */
  repeatRows?: number;
  repeatColumns?: number;
  /** Zero-based positions: start a new page before this row/column. */
  rowBreaks?: number[];
  columnBreaks?: number[];
}
export interface Sheet {
  id: string;
  name: string;
  cells: Record<string, Cell>;
  rowCount: number;
  colCount: number;
  columnWidths?: Record<number, number>;
  /** Sparse row heights in pixels, keyed by zero-based row. */
  rowHeights?: Record<number, number>;
  /** Sparse hidden row/column coordinates, zero-based. */
  hiddenRows?: number[];
  hiddenColumns?: number[];
  frozenRows?: number;
  merges?: CellRange[];
  printSettings?: PrintSettings;
  dataValidations?: DataValidationRule[];
  /** Optional server/data-source paging metadata for report mode. */
  dataSource?: {
    kind: 'static' | 'paged';
    totalRows?: number;
    pageSize?: number;
  };
}
export interface Workbook {
  id: string;
  name: string;
  description: string;
  sheets: Sheet[];
  activeSheetId: string;
  updatedAt: string;
  createdAt: string;
  starred?: boolean;
  category?: string;
}
export interface Revision {
  id: string;
  name: string;
  createdAt: string;
  workbook: Workbook;
}
export interface Comment {
  id: string;
  sheetId: string;
  cell: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}
export interface Selection {
  row: number;
  col: number;
  endRow?: number;
  endCol?: number;
}
