import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bold,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clipboard,
  CloudUpload,
  Copy,
  Download,
  Ellipsis,
  FilePlus2,
  FileSpreadsheet,
  Filter,
  FolderOpen,
  Grid2X2,
  History,
  Home,
  Italic,
  Keyboard,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Link2,
  ListFilter,
  LockKeyhole,
  Menu,
  MessageSquare,
  Minus,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Percent,
  Plus,
  Redo2,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Upload,
  Users,
  X,
  AlignLeft,
  AlignCenter,
  AlignRight,
  PaintBucket,
  Type,
  Merge,
  Snowflake,
  SortAsc,
  SortDesc,
  CheckCircle2,
  Wallet,
  TrendingUp,
  Target,
  Zap,
  Globe,
  Maximize2,
  FileJson,
  CalendarDays,
} from 'lucide-react';
import type {
  CellStyle,
  CellValue,
  Workbook,
  Sheet,
  Selection,
  Revision,
  Comment,
} from './lib/types';
import {
  cellKey,
  columnLabel,
  parseCellKey,
  createEvaluator,
  evaluateCell,
  displayCell,
  MAX_COLUMNS,
  MAX_ROWS,
} from './lib/engine';
import { createDemoWorkbook, createBlankWorkbook, createTemplateWorkbook } from './lib/seed';
import { exportWorkbook, importFile, validateWorkbook, IMPORT_LIMITS } from './lib/io';
import { loadWorkbooks, readStored, writeStored, snapshotLink, readSnapshot } from './lib/storage';
import { getPersistence } from './lib/persistence';
import { createCalculationRuntime } from './lib/calculation';
import { planWorkbookRowSort } from './lib/workbook-sort';
import type { RowSortRequest } from './lib/row-sort';
import SortDialog from './components/SortDialog';
import Spreadsheet from './components/Spreadsheet';
import Analytics, { readWorkbookAnalytics } from './components/Analytics';
import Insights from './components/Insights';
import Modal from './components/Modal';

type ModalName =
  | 'templates'
  | 'new'
  | 'share'
  | 'history'
  | 'comments'
  | 'help'
  | 'settings'
  | 'search'
  | 'plans'
  | 'rename'
  | 'sort'
  | null;
const money = (n: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n);
const dateTime = (s: string) =>
  new Date(s).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const templates = [
  {
    id: 'finance',
    name: '年度经营分析',
    tag: '财务管理',
    description: '收入、成本与利润，每一笔清晰可见。',
    color: 'green',
    icon: TrendingUp,
  },
  {
    id: 'project',
    name: '项目进度管理',
    tag: '项目协作',
    description: '聚焦关键节点，让团队始终步调一致。',
    color: 'blue',
    icon: Layers,
  },
  {
    id: 'budget',
    name: '部门预算规划',
    tag: '预算管理',
    description: '从预算到执行，更从容地分配资源。',
    color: 'orange',
    icon: Wallet,
  },
  {
    id: 'sales',
    name: '销售业绩追踪',
    tag: '销售运营',
    description: '发现增长机会，让每一个目标可衡量。',
    color: 'purple',
    icon: Target,
  },
];

function independentCopy(source: Workbook): Workbook {
  const copy = structuredClone(source),
    ids = new Map(copy.sheets.map((sheet) => [sheet.id, crypto.randomUUID()]));
  copy.id = crypto.randomUUID();
  copy.sheets = copy.sheets.map((sheet) => ({ ...sheet, id: ids.get(sheet.id)! }));
  copy.activeSheetId = ids.get(copy.activeSheetId) || copy.sheets[0].id;
  return copy;
}
function initialBooks(): Workbook[] {
  const stored: unknown = loadWorkbooks();
  const existing: Workbook[] = [];
  const seen = new Set<string>();
  if (Array.isArray(stored))
    for (const raw of stored) {
      try {
        let valid = validateWorkbook(raw);
        if (seen.has(valid.id)) valid = independentCopy(valid);
        seen.add(valid.id);
        existing.push(valid);
      } catch {
        /* A damaged entry does not hide other saved workbooks. */
      }
    }
  try {
    const snap = readSnapshot();
    if (snap) {
      const copy = independentCopy(validateWorkbook(snap));
      copy.name += ' · 共享副本';
      return [copy, ...existing];
    }
  } catch {
    /* Invalid external snapshots do not replace local documents. */
  }
  return existing.length ? existing : [createDemoWorkbook()];
}
export default function App() {
  const [books, setBooks] = useState<Workbook[]>(initialBooks);
  const [activeId, setActiveId] = useState(() => {
    const saved = readStored<string>('activeWorkbook', '');
    return location.hash.includes('snapshot=')
      ? books[0].id
      : books.some((b) => b.id === saved)
        ? saved
        : books[0].id;
  });
  const book = books.find((b) => b.id === activeId) || books[0];
  const sheet = book.sheets.find((s) => s.id === book.activeSheetId) || book.sheets[0];
  const [selection, setSelection] = useState<Selection>(() => ({
    row: window.innerWidth <= 740 ? 0 : Math.min(1, sheet.rowCount - 1),
    col: window.innerWidth <= 740 ? 0 : Math.min(3, sheet.colCount - 1),
  }));
  const [tab, setTab] = useState<'sheet' | 'analytics'>('sheet');
  const [workspace, setWorkspace] = useState('workspace');
  const [insights, setInsights] = useState(() => window.innerWidth > 900);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 740);
  const [modal, setModal] = useState<ModalName>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const sortButton = useRef<HTMLButtonElement>(null);
  const sortDialogOpen = useRef(false);
  useEffect(() => {
    if (sortDialogOpen.current && modal !== 'sort') sortButton.current?.focus();
    sortDialogOpen.current = modal === 'sort';
  }, [modal]);
  const [templateFilter, setTemplateFilter] = useState('精选模板');
  const [menu, setMenu] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [toast, setToast] = useState('');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [formula, setFormula] = useState('');
  const [address, setAddress] = useState('D2');
  const [nameInput, setNameInput] = useState('');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [sharedUrl, setSharedUrl] = useState('');
  const [trash, setTrash] = useState<Workbook[]>(() => readStored('trash', []));
  const undoStack = useRef<Workbook[]>([]),
    redoStack = useRef<Workbook[]>([]);
  const [, refreshHistory] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const formulaBlurSkip = useRef(false);
  const [busy, setBusy] = useState(false);
  const persistence = useRef(getPersistence());
  const calculation = useRef<ReturnType<typeof createCalculationRuntime> | null>(null);
  const [calculationVersion, setCalculationVersion] = useState(0);
  const [calculatedValues, setCalculatedValues] = useState<Record<string, CellValue>>({});
  const calculatedRevision = useRef(-1);
  const renderEvaluator = useMemo(
    () => createEvaluator(book, { revision: calculationVersion }),
    [book, calculationVersion],
  );
  const renderValue = useCallback(
    (targetSheet: Sheet, key: string): CellValue =>
      (calculatedRevision.current === calculationVersion
        ? calculatedValues[`${targetSheet.id}:${key}`]
        : undefined) ?? renderEvaluator(targetSheet, key),
    [calculatedValues, calculationVersion, renderEvaluator],
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const selectedCell = sheet.cells[cellKey(selection.row, selection.col)];
  const persistenceHydrated = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has('snapshot')) {
      persistenceHydrated.current = true;
      return;
    }
    let cancelled = false;
    void persistence.current.loadWorkbooks().then((loaded) => {
      if (cancelled) return;
      if (!loaded.length) {
        void persistence.current.putWorkbooks(books).catch(() => undefined);
        persistenceHydrated.current = true;
        return;
      }
      const valid = loaded.flatMap((raw) => {
        try {
          return [validateWorkbook(raw)];
        } catch {
          return [];
        }
      });
      if (!valid.length) return;
      setBooks(valid);
      setActiveId((current) => (valid.some((book) => book.id === current) ? current : valid[0].id));
      persistenceHydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const runtime = createCalculationRuntime();
    calculation.current = runtime;
    return () => {
      runtime.dispose();
      calculation.current = null;
    };
  }, []);
  useEffect(() => {
    setCalculatedValues({});
    calculatedRevision.current = -1;
    const targets = book.sheets.flatMap((currentSheet) =>
      Object.entries(currentSheet.cells)
        .filter(([, cell]) => typeof cell.value === 'string' && cell.value.startsWith('='))
        .slice(0, 25_000)
        .map(([key]) => ({ sheetId: currentSheet.id, key })),
    );
    const revision = calculationVersion;
    let cancelled = false;
    void calculation
      .current!.calculate(book, targets, revision)
      .then((result) => {
        if (!cancelled && result.revision === calculationVersion) {
          calculatedRevision.current = result.revision;
          setCalculatedValues(result.values);
        }
      })
      .catch(() => {
        /* The synchronous evaluator remains the safe rendering fallback. */
      });
    return () => {
      cancelled = true;
    };
  }, [book, calculationVersion]);
  useEffect(() => {
    setFormula(String(selectedCell?.value ?? ''));
    setAddress(cellKey(selection.row, selection.col));
  }, [selection, sheet.id, selectedCell?.value]);
  useEffect(() => {
    writeStored('activeWorkbook', activeId);
  }, [activeId]);
  useEffect(() => {
    setSaveState('saving');
    const timer = setTimeout(() => {
      void persistence.current
        .flush()
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 350);
    if (persistenceHydrated.current) void persistence.current.flush().catch(() => undefined);
    return () => clearTimeout(timer);
  }, [books]);
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has('snapshot'))
      history.replaceState(null, '', location.pathname + location.search);
  }, []);
  useEffect(() => {
    void persistence.current.loadRevisions(book.id).then(setRevisions);
    void persistence.current.loadComments(book.id).then(setComments);
    undoStack.current = [];
    redoStack.current = [];
    setSelection({
      row: window.innerWidth <= 740 ? 0 : Math.min(1, sheet.rowCount - 1),
      col: window.innerWidth <= 740 ? 0 : Math.min(3, sheet.colCount - 1),
    });
  }, [book.id]);
  useEffect(() => {
    setSelection((current) => ({
      row: Math.min(current.row, sheet.rowCount - 1),
      col: Math.min(current.col, sheet.colCount - 1),
      ...(current.endRow !== undefined
        ? { endRow: Math.min(current.endRow, sheet.rowCount - 1) }
        : {}),
      ...(current.endCol !== undefined
        ? { endCol: Math.min(current.endCol, sheet.colCount - 1) }
        : {}),
    }));
  }, [sheet.id, sheet.rowCount, sheet.colCount]);
  const updateBook = useCallback(
    (next: Workbook, track = true) => {
      if (track) {
        undoStack.current.push(structuredClone(book));
        undoStack.current = undoStack.current.slice(-60);
        redoStack.current = [];
      }
      setBooks((prev) =>
        prev.map((b) => (b.id === book.id ? { ...next, updatedAt: new Date().toISOString() } : b)),
      );
      setCalculationVersion((version) => version + 1);
      refreshHistory((n) => n + 1);
    },
    [book],
  );
  function changeSheet(next: Sheet) {
    if (
      next.rowCount > IMPORT_LIMITS.rows ||
      next.colCount > IMPORT_LIMITS.columns ||
      Object.keys(next.cells).length > IMPORT_LIMITS.cells
    ) {
      notify('当前版本最多支持 100,000 行、256 列和 100,000 个已存储单元格');
      return;
    }
    const previous = book.sheets.find((item) => item.id === next.id);
    if (previous && previous.cells !== next.cells) {
      const keys = new Set([...Object.keys(previous.cells), ...Object.keys(next.cells)]);
      for (const key of keys) {
        const before = previous.cells[key],
          after = next.cells[key];
        if (JSON.stringify(before) !== JSON.stringify(after))
          persistence.current.queueCellPatch(book.id, next.id, key, after ?? null);
      }
    }
    if (previous) {
      const { cells: _beforeCells, ...beforeMeta } = previous;
      const { cells: _afterCells, ...afterMeta } = next;
      if (JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta))
        persistence.current.queuePatch(book.id, {
          kind: 'sheet-meta',
          sheetId: next.id,
          changes: afterMeta,
        });
    }
    updateBook({ ...book, sheets: book.sheets.map((s) => (s.id === next.id ? next : s)) });
  }
  const applySheetPatches = useCallback(
    (
      sheetId: string,
      changes: Array<{ key: string; cell: import('./lib/types').Cell | null }>,
      dimensions?: { rowCount?: number; colCount?: number },
    ) => {
      const target = book.sheets.find((item) => item.id === sheetId);
      if (!target || changes.length > IMPORT_LIMITS.cells) return;
      const cells = { ...target.cells };
      for (const change of changes) {
        if (change.cell === null) delete cells[change.key];
        else cells[change.key] = change.cell;
        persistence.current.queueCellPatch(book.id, sheetId, change.key, change.cell);
      }
      if (dimensions)
        persistence.current.queuePatch(book.id, {
          kind: 'sheet-meta',
          sheetId,
          changes: dimensions,
        });
      updateBook({
        ...book,
        sheets: book.sheets.map((item) =>
          item.id === sheetId ? { ...item, ...dimensions, cells } : item,
        ),
      });
    },
    [book, updateBook],
  );
  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(structuredClone(book));
    setBooks((prev) => prev.map((b) => (b.id === book.id ? previous : b)));
    setCalculationVersion((version) => version + 1);
    void persistence.current.compact(previous).catch(() => undefined);
    refreshHistory((n) => n + 1);
  }
  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(structuredClone(book));
    setBooks((prev) => prev.map((b) => (b.id === book.id ? next : b)));
    setCalculationVersion((version) => version + 1);
    void persistence.current.compact(next).catch(() => undefined);
    refreshHistory((n) => n + 1);
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const command = e.metaKey || e.ctrlKey,
        key = e.key.toLowerCase();
      if (command && key === 'k') {
        e.preventDefault();
        setModal('search');
      }
      if (command && key === 's') {
        e.preventDefault();
        void persistence.current
          .compact(book)
          .then(() => notify('工作簿已保存到本地'))
          .catch(() => notify('本地保存失败，请导出文件备份'));
      }
      const target = e.target as HTMLElement | null;
      const editing = target?.closest('input,textarea,select,[contenteditable="true"]');
      if (command && !editing && !modal && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
      }
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [books, book, notify, modal]);
  function addBook(next: Workbook) {
    const unique = books.some((existing) => existing.id === next.id) ? independentCopy(next) : next;
    setBooks((prev) => [unique, ...prev]);
    setActiveId(unique.id);
    setWorkspace('workspace');
    setModal(null);
    setTab('sheet');
    setFilter('');
    setSearch('');
    notify('工作簿已创建');
  }
  function setCellValue(value: string) {
    const key = cellKey(selection.row, selection.col);
    let parsed: string | number | boolean = value;
    if (value.startsWith("'")) parsed = value.slice(1);
    else if (value === 'TRUE' || value === 'FALSE') parsed = value === 'TRUE';
    else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) {
      const n = Number(value);
      if (Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n))) parsed = n;
    }
    if (sheet.cells[key]?.value === parsed) return;
    applySheetPatches(sheet.id, [{ key, cell: { ...sheet.cells[key], value: parsed } }]);
  }
  function insertInsightFormula(value: string) {
    const occupied = Object.entries(sheet.cells)
      .filter(([, cell]) => cell.value !== '')
      .map(([key]) => parseCellKey(key))
      .filter((point): point is { row: number; col: number } => !!point);
    const lastCol = occupied.reduce((last, point) => Math.max(last, point.col), -1),
      lastRow = occupied.reduce((last, point) => Math.max(last, point.row), -1);
    const mergeLastCol = (sheet.merges || []).reduce(
      (last, merge) => Math.max(last, merge.end.col),
      lastCol,
    );
    let row = 0,
      col = mergeLastCol + 2;
    if (col >= MAX_COLUMNS) {
      row = Math.max(lastRow, ...(sheet.merges || []).map((merge) => merge.end.row)) + 2;
      col = 0;
    }
    if (row >= MAX_ROWS) {
      notify('工作表范围已满，请新建工作表后插入公式');
      return;
    }
    const key = cellKey(row, col);
    changeSheet({
      ...sheet,
      cells: {
        ...sheet.cells,
        [key]: {
          value,
          style: {
            ...sheet.cells[key]?.style,
            bold: true,
            format: 'number',
            background: '#eef5ef',
            color: '#286344',
          },
        },
      },
      rowCount: Math.max(sheet.rowCount, row + 1),
      colCount: Math.max(sheet.colCount, col + 1),
    });
    setSelection({ row, col });
    setFilter('');
    setSearch('');
    setTab('sheet');
    notify(`汇总公式已插入空白单元格 ${key}`);
  }
  function applyStyle(style: CellStyle) {
    if (
      (Math.abs((selection.endRow ?? selection.row) - selection.row) + 1) *
        (Math.abs((selection.endCol ?? selection.col) - selection.col) + 1) >
      100000
    ) {
      notify('一次最多为 100,000 个单元格设置样式，请缩小选区');
      return;
    }
    const cells = { ...sheet.cells };
    for (
      let r = Math.min(selection.row, selection.endRow ?? selection.row);
      r <= Math.max(selection.row, selection.endRow ?? selection.row);
      r++
    )
      for (
        let c = Math.min(selection.col, selection.endCol ?? selection.col);
        c <= Math.max(selection.col, selection.endCol ?? selection.col);
        c++
      ) {
        const key = cellKey(r, c);
        cells[key] = {
          ...cells[key],
          value: cells[key]?.value ?? '',
          style: { ...cells[key]?.style, ...style },
        };
      }
    changeSheet({ ...sheet, cells });
  }
  function addSheet() {
    let n = book.sheets.length + 1;
    while (book.sheets.some((s) => s.name === `工作表 ${n}`)) n++;
    const next: Sheet = {
      id: crypto.randomUUID(),
      name: `工作表 ${n}`,
      cells: {},
      rowCount: 100,
      colCount: 26,
    };
    updateBook({ ...book, sheets: [...book.sheets, next], activeSheetId: next.id });
    setSelection({ row: 0, col: 0 });
    notify('已添加新工作表');
  }
  function selectSheet(id: string) {
    updateBook({ ...book, activeSheetId: id }, false);
    setSelection({ row: 0, col: 0 });
    setFilter('');
  }
  async function handleExport(format: 'xlsx' | 'csv' | 'json' | 'pdf') {
    setMenu(null);
    setBusy(true);
    try {
      await exportWorkbook(book, format);
      notify(`${format.toUpperCase()} 文件已导出`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '文件导出失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  async function handleImport(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await importFile(file);
      addBook(result);
      notify(`已导入 ${result.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法读取此文件');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  function saveVersion() {
    const next = {
      id: crypto.randomUUID(),
      name: `手动保存 · ${dateTime(new Date().toISOString())}`,
      createdAt: new Date().toISOString(),
      workbook: structuredClone(book),
    };
    const list = [next, ...revisions].slice(0, 20);
    setRevisions(list);
    void persistence.current
      .saveRevisions(book.id, list)
      .then(() => notify('已保存当前版本'))
      .catch(() => notify('本地存储空间不足，请导出备份'));
  }
  function openHistory() {
    void persistence.current.loadRevisions(book.id).then(setRevisions);
    setModal('history');
  }
  function archiveBook() {
    const next = [book, ...trash];
    setTrash(next);
    writeStored('trash', next);
    const remaining = books.filter((b) => b.id !== book.id);
    const result = remaining.length ? remaining : [createBlankWorkbook()];
    setBooks(result);
    setActiveId(result[0].id);
    setMenu(null);
    notify('已移到回收站，可随时恢复');
  }
  function addComment() {
    if (!commentInput.trim()) return;
    const next = [
      ...comments,
      {
        id: crypto.randomUUID(),
        sheetId: sheet.id,
        cell: cellKey(selection.row, selection.col),
        text: commentInput.trim(),
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    ];
    setComments(next);
    void persistence.current.saveComments(book.id, next);
    setCommentInput('');
    notify('批注已添加');
  }
  function openSort(direction: 'asc' | 'desc') {
    setSortDirection(direction);
    setMenu(null);
    setModal('sort');
  }
  function sortSheet(request: RowSortRequest) {
    // Resolve and validate the whole candidate before queuing persistence or
    // creating a history entry. Rejections leave the dialog and workbook intact.
    const planned = planWorkbookRowSort(book, sheet.id, request);
    if (planned.changes.length) applySheetPatches(sheet.id, planned.changes);
    setModal(null);
    notify(
      planned.changes.length
        ? `已移动 ${planned.movedRows} 行，公式已保留 · 可一次撤销`
        : '当前顺序已符合条件，没有新增撤销记录',
    );
  }
  function mergeCells() {
    const r1 = Math.min(selection.row, selection.endRow ?? selection.row),
      r2 = Math.max(selection.row, selection.endRow ?? selection.row),
      c1 = Math.min(selection.col, selection.endCol ?? selection.col),
      c2 = Math.max(selection.col, selection.endCol ?? selection.col);
    const ranges = sheet.merges || [],
      single = r1 === r2 && c1 === c2;
    const overlaps = ranges.filter(
      (merge) =>
        r1 <= merge.end.row &&
        r2 >= merge.start.row &&
        c1 <= merge.end.col &&
        c2 >= merge.start.col,
    );
    const existing =
      overlaps.length === 1 &&
      (single ||
        (r1 === overlaps[0].start.row &&
          r2 === overlaps[0].end.row &&
          c1 === overlaps[0].start.col &&
          c2 === overlaps[0].end.col))
        ? overlaps[0]
        : undefined;
    if (existing) {
      changeSheet({ ...sheet, merges: ranges.filter((merge) => merge !== existing) });
      notify('已取消合并');
      return;
    }
    if (overlaps.length) {
      notify('选区与已有合并单元格重叠，请先取消原有合并');
      return;
    }
    if (single) {
      notify('按住 Shift 选择多个单元格后合并');
      return;
    }
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 10000 || sheet.rowCount * sheet.colCount > 100000) {
      notify('当前表格或合并范围过大，请缩小范围后重试');
      return;
    }
    const occupied = Object.entries(sheet.cells).filter(([key, cell]) => {
      const p = parseCellKey(key);
      return p && p.row >= r1 && p.row <= r2 && p.col >= c1 && p.col <= c2 && cell.value !== '';
    });
    if (occupied.length > 1) {
      notify('为保留数据，请只合并最多包含一个非空单元格的区域');
      return;
    }
    const cells = { ...sheet.cells },
      targetKey = cellKey(r1, c1);
    if (occupied.length === 1 && occupied[0][0] !== targetKey) {
      const [sourceKey, source] = occupied[0];
      cells[targetKey] = { ...cells[targetKey], ...source };
      cells[sourceKey] = { ...source, value: '' };
    }
    changeSheet({
      ...sheet,
      cells,
      merges: [...ranges, { start: { row: r1, col: c1 }, end: { row: r2, col: c2 } }],
    });
    setSelection({ row: r1, col: c1 });
  }
  const stats = useMemo(() => {
    const analysis = readWorkbookAnalytics(book),
      revenue = analysis.rows.reduce((sum, row) => sum + row.revenue, 0),
      profit = analysis.hasProfit
        ? analysis.rows.reduce((sum, row) => sum + (row.profit ?? 0), 0)
        : null;
    const currentRows = new Set(
      Object.entries(sheet.cells).flatMap(([key, cell]) => {
        const point = parseCellKey(key);
        return point && point.row > 0 && cell.value !== '' ? [point.row] : [];
      }),
    );
    return {
      revenue,
      profit,
      margin: profit !== null && revenue !== 0 ? profit / revenue : null,
      count: analysis.financial ? analysis.rows.length : currentRows.size,
      financial: analysis.financial,
      source: analysis.sheet?.name,
      hasCost: analysis.hasCost,
    };
  }, [book, sheet]);
  const selectedStats = useMemo(() => {
    const evaluate = createEvaluator(book);
    let count = 0,
      sum = 0,
      numbers = 0;
    const top = Math.min(selection.row, selection.endRow ?? selection.row),
      bottom = Math.max(selection.row, selection.endRow ?? selection.row),
      left = Math.min(selection.col, selection.endCol ?? selection.col),
      right = Math.max(selection.col, selection.endCol ?? selection.col);
    for (const key of Object.keys(sheet.cells)) {
      const point = parseCellKey(key);
      if (!point || point.row < top || point.row > bottom || point.col < left || point.col > right)
        continue;
      const value = evaluate(sheet, key);
      if (value !== '') count++;
      if (typeof value === 'number') {
        sum += value;
        numbers++;
      }
    }
    return { count, sum, avg: numbers ? sum / numbers : 0 };
  }, [selection, sheet, book]);
  const listedBooks =
    workspace === 'starred'
      ? books.filter((b) => b.starred)
      : workspace === 'recent'
        ? [...books].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        : books;
  const IconBtn = ({
    label,
    children,
    onClick,
    active = false,
    disabled = false,
  }: {
    label: string;
    children: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
  }) => (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'}`}>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.csv,.tsv,.json"
        className="hidden"
        onChange={(e) => handleImport(e.target.files?.[0])}
      />
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setWorkspace('workspace');
          }}
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <strong>
            Lumina<span>灵表</span>
          </strong>
          <span className="brand-beta">BETA</span>
        </a>
        <button className="workspace-switch" onClick={() => setModal('settings')}>
          <span className="workspace-avatar">L</span>
          <span>
            <strong>我的工作空间</strong>
            <small>个人空间</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button className="sidebar-search" onClick={() => setModal('search')}>
          <Search size={16} />
          <span>搜索工作空间</span>
          <kbd>⌘ K</kbd>
        </button>
        <button
          className="new-button"
          onClick={() => {
            setNameInput('');
            setModal('new');
          }}
        >
          <Plus size={17} />
          新建工作簿
          <ChevronDown size={13} />
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={workspace === 'workspace' ? 'nav-item current' : 'nav-item'}
            onClick={() => setWorkspace('workspace')}
          >
            <Grid2X2 size={18} />
            工作空间<span className="nav-count">{books.length}</span>
          </button>
          <button
            className={workspace === 'recent' ? 'nav-item current' : 'nav-item'}
            onClick={() => setWorkspace('recent')}
          >
            <History size={18} />
            最近访问
          </button>
          <button
            className={workspace === 'starred' ? 'nav-item current' : 'nav-item'}
            onClick={() => setWorkspace('starred')}
          >
            <Star size={18} />
            我的收藏
          </button>
          <button className="nav-item" onClick={() => setModal('templates')}>
            <LayoutTemplate size={18} />
            模板中心<span className="nav-new">NEW</span>
          </button>
          <a className="nav-item" href="/examples/report.html">
            报表 JS 组件
          </a>
          <a className="nav-item" href="/performance">
            性能实验室
          </a>
        </nav>
        <div className="sidebar-section-title">
          工作簿
          <button
            title="导入工作簿"
            aria-label="导入工作簿"
            onClick={() => fileInput.current?.click()}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="workbook-list">
          {listedBooks.map((b) => (
            <button
              key={b.id}
              title={b.name}
              className={`workbook-item ${b.id === book.id ? 'selected' : ''}`}
              onClick={() => {
                setActiveId(b.id);
                setTab('sheet');
                if (window.innerWidth <= 740) setSidebar(false);
              }}
            >
              <FileSpreadsheet size={17} />
              <span>{b.name}</span>
              {b.starred && <span className="tiny-star">★</span>}
            </button>
          ))}
          {listedBooks.length === 0 && (
            <p className="sidebar-empty">
              点击工作簿标题旁的星标，
              <br />
              收藏常用工作簿。
            </p>
          )}
        </div>
        <button
          className={`nav-item trash-nav ${workspace === 'trash' ? 'current' : ''}`}
          onClick={() => setWorkspace(workspace === 'trash' ? 'workspace' : 'trash')}
        >
          <Trash2 size={17} />
          回收站{trash.length > 0 && <span className="nav-count">{trash.length}</span>}
        </button>
        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <span className="upgrade-icon">
              <Zap size={16} />
            </span>
            <strong>为更好的工作而生</strong>
            <p>探索更高效的数据工作方式</p>
            <button onClick={() => setModal('plans')}>
              了解 Lumina <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="sidebar-footer">
            <button onClick={() => setModal('help')}>
              <CircleHelp size={17} />
              帮助与反馈
            </button>
            <button
              title="工作空间设置"
              aria-label="工作空间设置"
              onClick={() => setModal('settings')}
            >
              <Settings2 size={17} />
            </button>
          </div>
          <button className="profile" onClick={() => setModal('settings')}>
            <span className="user-avatar">我</span>
            <span>
              <strong>我的账户</strong>
              <small>本地工作空间</small>
            </span>
            <Ellipsis size={18} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <IconBtn label={sidebar ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebar(!sidebar)}>
              <PanelLeftClose size={18} />
            </IconBtn>
            <span>工作空间</span>
            <ChevronRight size={14} />
            <span className="breadcrumb-current">
              {workspace === 'trash' ? '回收站' : book.name}
            </span>
          </div>
          <div className="topbar-actions">
            <span className={`save-indicator ${saveState === 'error' ? 'error' : ''}`}>
              <CloudUpload size={15} />
              {saveState === 'saving'
                ? '正在保存…'
                : saveState === 'error'
                  ? '存储空间不足'
                  : '已保存到本地'}
            </span>
            <span className="topbar-divider" />
            <IconBtn label="版本历史" onClick={openHistory}>
              <History size={18} />
            </IconBtn>
            <IconBtn
              label="通知"
              onClick={() => notify('所有更改均已保存在当前浏览器，本地工作空间暂无新通知')}
            >
              <Bell size={18} />
            </IconBtn>
            <span className="user-avatar small">我</span>
          </div>
        </header>
        {workspace === 'trash' ? (
          <section className="trash-page">
            <div className="page-heading">
              <div>
                <h1>回收站</h1>
                <p>已删除的工作簿会保留在这里，直到恢复。</p>
              </div>
            </div>
            {trash.length ? (
              trash.map((b) => (
                <div className="trash-row" key={b.id}>
                  <FileSpreadsheet />
                  <div>
                    <strong>{b.name}</strong>
                    <p>
                      {b.sheets.length} 个工作表 · {dateTime(b.updatedAt)}
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      const remaining = trash.filter((x) => x.id !== b.id);
                      setTrash(remaining);
                      writeStored('trash', remaining);
                      addBook(b);
                    }}
                  >
                    恢复工作簿
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Trash2 size={36} />
                <h3>回收站很干净</h3>
                <p>删除的工作簿会出现在这里。</p>
                <button className="button secondary" onClick={() => setWorkspace('workspace')}>
                  返回工作空间
                </button>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="document-heading">
              <div className="title-group">
                <div className="document-icon">
                  <FileSpreadsheet size={27} />
                </div>
                <div>
                  <div className="title-line">
                    <h1
                      onDoubleClick={() => {
                        setNameInput(book.name);
                        setModal('rename');
                      }}
                    >
                      {book.name}
                    </h1>
                    <IconBtn
                      label={book.starred ? '取消收藏' : '收藏工作簿'}
                      active={book.starred}
                      onClick={() => updateBook({ ...book, starred: !book.starred }, false)}
                    >
                      <Star size={18} fill={book.starred ? 'currentColor' : 'none'} />
                    </IconBtn>
                    <span className="document-label">{book.category || '经营分析'}</span>
                  </div>
                  <p>
                    {book.description || '让数据井然有序，让决策更进一步。'}
                    <span className="heading-dot">·</span>
                    <span>本地工作簿</span>
                  </p>
                </div>
              </div>
              <div className="heading-actions">
                <button
                  className="button secondary"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                >
                  <Upload size={15} />
                  导入
                </button>
                <div className="menu-anchor">
                  <button
                    className="button secondary"
                    onClick={() => setMenu(menu === 'export' ? null : 'export')}
                    disabled={busy}
                  >
                    <Download size={15} />
                    导出
                    <ChevronDown size={13} />
                  </button>
                  {menu === 'export' && (
                    <div className="dropdown export-menu">
                      <strong>导出工作簿</strong>
                      <button onClick={() => handleExport('xlsx')}>
                        <FileSpreadsheet size={16} />
                        Excel 工作簿<span>.xlsx</span>
                      </button>
                      <button onClick={() => handleExport('csv')}>
                        <Table2 size={16} />
                        当前工作表<span>.csv</span>
                      </button>
                      <button onClick={() => handleExport('json')}>
                        <FileJson size={16} />
                        完整数据与样式<span>.json</span>
                      </button>
                      <button onClick={() => handleExport('pdf')}>
                        <FileSpreadsheet size={16} />
                        当前报表<span>.pdf</span>
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setSharedUrl('');
                    setModal('share');
                  }}
                >
                  <Share2 size={15} />
                  分享工作簿
                </button>
                <div className="menu-anchor">
                  <IconBtn
                    label="更多工作簿操作"
                    onClick={() => setMenu(menu === 'more' ? null : 'more')}
                  >
                    <Ellipsis size={20} />
                  </IconBtn>
                  {menu === 'more' && (
                    <div className="dropdown align-right">
                      <button
                        onClick={() => {
                          setNameInput(book.name);
                          setModal('rename');
                          setMenu(null);
                        }}
                      >
                        <Type size={16} />
                        重命名
                      </button>
                      <button
                        onClick={() => {
                          const copy = independentCopy(book);
                          copy.name += ' · 副本';
                          addBook(copy);
                          setMenu(null);
                        }}
                      >
                        <Copy size={16} />
                        创建副本
                      </button>
                      <button
                        onClick={() => {
                          saveVersion();
                          setMenu(null);
                        }}
                      >
                        <History size={16} />
                        保存版本
                      </button>
                      <button className="danger" onClick={archiveBook}>
                        <Trash2 size={16} />
                        移到回收站
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
            {tab === 'sheet' && (
              <section className="metrics-strip" aria-label="工作簿关键指标">
                <div className="metric-card">
                  <span className="metric-label">
                    <span className="metric-symbol green">
                      <Wallet size={15} />
                    </span>
                    {stats.financial ? '累计营业收入' : '数据记录'}
                  </span>
                  <div className="metric-value">
                    {stats.financial ? (
                      <>
                        <span className="currency">¥</span>
                        {money(stats.revenue)}
                      </>
                    ) : (
                      <>
                        {stats.count}
                        <small>条</small>
                      </>
                    )}
                    <span className="metric-trend">
                      <span className="metric-live-dot" />
                      实时计算
                    </span>
                  </div>
                  <p>
                    {stats.financial
                      ? `${stats.source} · ${stats.count} 条有效记录`
                      : '当前工作表的非空数据行'}
                  </p>
                </div>
                <div className="metric-card">
                  <span className="metric-label">
                    <span className="metric-symbol blue">
                      <BarChart3 size={15} />
                    </span>
                    {stats.financial ? '累计营业利润' : '工作表'}
                  </span>
                  <div className="metric-value">
                    {stats.financial ? (
                      stats.profit !== null ? (
                        <>
                          <span className="currency">¥</span>
                          {money(stats.profit)}
                        </>
                      ) : (
                        '—'
                      )
                    ) : (
                      <>
                        {book.sheets.length}
                        <small>张</small>
                      </>
                    )}
                    <span className="metric-soft-label">
                      {stats.financial
                        ? stats.profit !== null
                          ? '按有效记录汇总'
                          : '数据不足'
                        : '多表联动'}
                    </span>
                  </div>
                  <p>
                    {stats.financial
                      ? stats.profit !== null
                        ? '更健康的经营，从了解利润开始'
                        : '补充完整成本或利润数据后可计算'
                      : '所有业务数据，汇聚一处'}
                  </p>
                </div>
                <div className="metric-card">
                  <span className="metric-label">
                    <span className="metric-symbol orange">
                      <TrendingUp size={15} />
                    </span>
                    {stats.financial ? '整体利润率' : '非空单元格'}
                  </span>
                  <div className="metric-value">
                    {stats.financial ? (
                      stats.margin !== null ? (
                        <>
                          {(stats.margin * 100).toFixed(1)}
                          <span className="currency">%</span>
                        </>
                      ) : (
                        '—'
                      )
                    ) : (
                      Object.values(sheet.cells).filter((c) => c.value !== '').length
                    )}
                  </div>
                  <p>
                    {stats.financial
                      ? stats.margin !== null
                        ? '总利润 ÷ 总营收'
                        : stats.profit === null
                          ? '成本或利润数据缺失'
                          : '总营收为零，暂时无法计算'
                      : '数据自动保存，灵感随时继续'}
                  </p>
                </div>
                <div className="insight-promo">
                  <div className="insight-promo-top">
                    <span>
                      <Sparkles size={17} />
                      发现数据背后的故事
                    </span>
                    <span className="new-pill">NEW</span>
                  </div>
                  <p>把繁琐的分析，变成清晰的洞察。</p>
                  <button
                    onClick={() => {
                      setInsights(true);
                      setTab('sheet');
                    }}
                  >
                    探索数据洞察 <ArrowRight size={15} />
                  </button>
                  <div className="promo-orbits">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </section>
            )}
            <section className="workbench">
              <div className="view-bar">
                <div className="view-tabs">
                  <button
                    className={tab === 'sheet' ? 'selected' : ''}
                    onClick={() => setTab('sheet')}
                  >
                    <Table2 size={16} />
                    工作表
                  </button>
                  <button
                    className={tab === 'analytics' ? 'selected' : ''}
                    onClick={() => setTab('analytics')}
                  >
                    <LayoutDashboard size={16} />
                    数据看板
                    <span className="tab-dot" />
                  </button>
                </div>
                <div className="view-actions">
                  <span className="demo-label">
                    {book.id.startsWith('demo') ? '示例数据 · 可自由编辑' : '浏览器本地存储'}
                  </span>
                  <button
                    aria-label="批注"
                    onClick={() => {
                      void persistence.current.loadComments(book.id).then(setComments);
                      setModal('comments');
                    }}
                  >
                    <MessageSquare size={16} />
                    <span>批注</span>
                    {comments.filter((c) => !c.resolved).length > 0 && (
                      <b>{comments.filter((c) => !c.resolved).length}</b>
                    )}
                  </button>
                  <button aria-label="版本历史" onClick={openHistory}>
                    <History size={16} />
                    <span>版本历史</span>
                  </button>
                  <button
                    className={insights ? 'view-insights active' : 'view-insights'}
                    onClick={() => {
                      setInsights(!insights);
                      setTab('sheet');
                    }}
                  >
                    <Sparkles size={15} />
                    <span>数据洞察</span>
                  </button>
                </div>
              </div>
              {tab === 'analytics' ? (
                <div className="analytics-wrap">
                  <Analytics workbook={book} />
                </div>
              ) : (
                <div className="editor-layout">
                  <div className="editor-main">
                    <div className="format-toolbar">
                      <div className="toolbar-group">
                        <IconBtn label="撤销" onClick={undo} disabled={!undoStack.current.length}>
                          <Undo2 size={16} />
                        </IconBtn>
                        <IconBtn label="重做" onClick={redo} disabled={!redoStack.current.length}>
                          <Redo2 size={16} />
                        </IconBtn>
                      </div>
                      <div className="toolbar-group font-controls">
                        <select
                          aria-label="数字格式"
                          value={selectedCell?.style?.format || 'general'}
                          onChange={(e) =>
                            applyStyle({ format: e.target.value as CellStyle['format'] })
                          }
                        >
                          <option value="general">常规</option>
                          <option value="number">数字</option>
                          <option value="currency">人民币</option>
                          <option value="percent">百分比</option>
                          <option value="date">日期</option>
                        </select>
                        <select
                          aria-label="字号"
                          value={selectedCell?.style?.fontSize || 13}
                          onChange={(e) => applyStyle({ fontSize: Number(e.target.value) })}
                        >
                          {[11, 12, 13, 14, 16, 18, 24].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="toolbar-group">
                        <IconBtn
                          label="加粗"
                          active={selectedCell?.style?.bold}
                          onClick={() => applyStyle({ bold: !selectedCell?.style?.bold })}
                        >
                          <Bold size={16} />
                        </IconBtn>
                        <IconBtn
                          label="斜体"
                          active={selectedCell?.style?.italic}
                          onClick={() => applyStyle({ italic: !selectedCell?.style?.italic })}
                        >
                          <Italic size={16} />
                        </IconBtn>
                        <IconBtn
                          label="下划线"
                          active={selectedCell?.style?.underline}
                          onClick={() => applyStyle({ underline: !selectedCell?.style?.underline })}
                        >
                          <Underline size={16} />
                        </IconBtn>
                        <label className="color-control" title="文字颜色">
                          <Type size={16} />
                          <span style={{ background: selectedCell?.style?.color || '#23735a' }} />
                          <input
                            type="color"
                            aria-label="文字颜色"
                            value={selectedCell?.style?.color || '#23735a'}
                            onChange={(e) => applyStyle({ color: e.target.value })}
                          />
                        </label>
                        <label className="color-control" title="填充颜色">
                          <PaintBucket size={16} />
                          <span
                            style={{ background: selectedCell?.style?.background || '#e1eedf' }}
                          />
                          <input
                            type="color"
                            aria-label="填充颜色"
                            value={selectedCell?.style?.background || '#e1eedf'}
                            onChange={(e) => applyStyle({ background: e.target.value })}
                          />
                        </label>
                      </div>
                      <div className="toolbar-group alignment-controls">
                        <IconBtn label="左对齐" onClick={() => applyStyle({ align: 'left' })}>
                          <AlignLeft size={16} />
                        </IconBtn>
                        <IconBtn label="居中对齐" onClick={() => applyStyle({ align: 'center' })}>
                          <AlignCenter size={16} />
                        </IconBtn>
                        <IconBtn label="右对齐" onClick={() => applyStyle({ align: 'right' })}>
                          <AlignRight size={16} />
                        </IconBtn>
                        <IconBtn label="合并或取消合并单元格" onClick={mergeCells}>
                          <Merge size={16} />
                        </IconBtn>
                      </div>
                      <div className="toolbar-group toolbar-data">
                        <div className="menu-anchor">
                          <button
                            aria-label="排序"
                            ref={sortButton}
                            className="toolbar-text-button"
                            onClick={() => setMenu(menu === 'sort' ? null : 'sort')}
                          >
                            <ListFilter size={16} />
                            <span>排序</span>
                            <ChevronDown size={12} />
                          </button>
                          {menu === 'sort' && (
                            <div className="dropdown">
                              <strong>按 {columnLabel(selection.col)} 列排序</strong>
                              <button onClick={() => openSort('asc')}>
                                <SortAsc size={16} />
                                升序排列
                              </button>
                              <button onClick={() => openSort('desc')}>
                                <SortDesc size={16} />
                                降序排列
                              </button>
                              <p className="menu-note">
                                选择行范围与排序条件，公式和整行数据一起移动。
                              </p>
                            </div>
                          )}
                        </div>
                        <button
                          aria-label="筛选"
                          className={`toolbar-text-button ${showFilter ? 'active' : ''}`}
                          onClick={() => {
                            setShowFilter(!showFilter);
                            if (showFilter) {
                              setFilter('');
                              setSearch('');
                            }
                          }}
                        >
                          <Filter size={15} />
                          <span>筛选</span>
                        </button>
                        <IconBtn
                          label={sheet.frozenRows ? '取消冻结首行' : '冻结首行'}
                          active={!!sheet.frozenRows}
                          onClick={() =>
                            changeSheet({ ...sheet, frozenRows: sheet.frozenRows ? 0 : 1 })
                          }
                        >
                          <Snowflake size={16} />
                        </IconBtn>
                      </div>
                      <div className="toolbar-end">
                        <IconBtn label="查找单元格" onClick={() => setShowFilter(!showFilter)}>
                          <Search size={16} />
                        </IconBtn>
                      </div>
                    </div>
                    {showFilter && (
                      <div className="filter-bar">
                        <Search size={15} />
                        <input
                          placeholder="搜索并高亮单元格…"
                          aria-label="查找内容"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <Filter size={14} />
                        <input
                          placeholder="筛选包含内容的行…"
                          aria-label="筛选行"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                        <button
                          className="icon-button"
                          aria-label="清除筛选"
                          onClick={() => {
                            setSearch('');
                            setFilter('');
                            setShowFilter(false);
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <div className="formula-bar">
                      <input
                        className="cell-address"
                        aria-label="单元格地址"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const point = parseCellKey(address.toUpperCase());
                            if (point && point.row < sheet.rowCount && point.col < sheet.colCount)
                              setSelection(point);
                            else notify('请输入工作表范围内的地址，例如 D2');
                          }
                        }}
                      />
                      <ChevronDown size={12} />
                      <span className="formula-divider" />
                      <span className="fx">ƒx</span>
                      <input
                        aria-label="公式编辑栏"
                        placeholder="输入内容或公式，例如 =SUM(D2:D13)"
                        value={formula}
                        onChange={(e) => setFormula(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            formulaBlurSkip.current = true;
                            setCellValue(formula);
                            (e.target as HTMLInputElement).blur();
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            formulaBlurSkip.current = true;
                            setFormula(String(selectedCell?.value ?? ''));
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={() => {
                          if (formulaBlurSkip.current) {
                            formulaBlurSkip.current = false;
                            return;
                          }
                          if (formula !== String(selectedCell?.value ?? '')) setCellValue(formula);
                        }}
                      />
                    </div>
                    <div className="grid-container">
                      <Spreadsheet
                        workbook={book}
                        sheet={sheet}
                        selection={selection}
                        onSelect={setSelection}
                        onChange={changeSheet}
                        onPatch={applySheetPatches}
                        getValue={renderValue}
                        calculationVersion={calculationVersion}
                        search={search}
                        filter={filter}
                        zoom={zoom}
                        showGrid={showGrid}
                      />
                    </div>
                    <div className="sheet-tabs-bar">
                      <div className="sheet-nav-icons">
                        <IconBtn
                          label="上一个工作表"
                          disabled={book.sheets.findIndex((s) => s.id === sheet.id) === 0}
                          onClick={() =>
                            selectSheet(
                              book.sheets[book.sheets.findIndex((s) => s.id === sheet.id) - 1].id,
                            )
                          }
                        >
                          <ChevronLeft size={14} />
                        </IconBtn>
                        <IconBtn
                          label="下一个工作表"
                          disabled={
                            book.sheets.findIndex((s) => s.id === sheet.id) ===
                            book.sheets.length - 1
                          }
                          onClick={() =>
                            selectSheet(
                              book.sheets[book.sheets.findIndex((s) => s.id === sheet.id) + 1].id,
                            )
                          }
                        >
                          <ChevronRight size={14} />
                        </IconBtn>
                      </div>
                      <div className="sheet-tabs">
                        {book.sheets.map((s) => (
                          <button
                            className={sheet.id === s.id ? 'sheet-tab active' : 'sheet-tab'}
                            key={s.id}
                            onClick={() => selectSheet(s.id)}
                          >
                            <Table2 size={14} />
                            {s.name}
                            {sheet.id === s.id && <ChevronDown size={12} />}
                          </button>
                        ))}
                      </div>
                      <IconBtn label="新增工作表" onClick={addSheet}>
                        <Plus size={17} />
                      </IconBtn>
                    </div>
                  </div>
                  {insights && (
                    <Insights
                      workbook={book}
                      onClose={() => setInsights(false)}
                      onApplyFormula={insertInsightFormula}
                    />
                  )}
                </div>
              )}
              <footer className="status-bar">
                <span className="ready">
                  <span />
                  就绪
                </span>
                <span className="status-location">
                  {sheet.name}
                  <span>·</span>
                  {sheet.rowCount} 行 × {sheet.colCount} 列
                </span>
                <div className="selection-stats">
                  <span>计数：{selectedStats.count}</span>
                  <span>求和：{money(selectedStats.sum)}</span>
                  <span>平均值：{money(selectedStats.avg)}</span>
                </div>
                <div className="zoom-controls">
                  <button
                    aria-label="切换网格线"
                    title="切换网格线"
                    onClick={() => setShowGrid(!showGrid)}
                  >
                    <Grid2X2 size={14} />
                  </button>
                  <span className="status-divider" />
                  <button aria-label="缩小" onClick={() => setZoom(Math.max(60, zoom - 10))}>
                    <Minus size={14} />
                  </button>
                  <input
                    aria-label="缩放比例"
                    type="range"
                    min="60"
                    max="150"
                    step="10"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                  <button aria-label="放大" onClick={() => setZoom(Math.min(150, zoom + 10))}>
                    <Plus size={14} />
                  </button>
                  <button className="zoom-value" onClick={() => setZoom(100)}>
                    {zoom}%
                  </button>
                </div>
              </footer>
            </section>
            <div className="page-footer">
              <span>
                <ShieldCheck size={13} />
                数据保存在您的浏览器中
              </span>
              <span>
                更简单的表格，更清晰的未来。<span className="footer-brand">Lumina</span>
              </span>
            </div>
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <span />
          正在处理文件…
        </div>
      )}
      {modal === 'sort' && (
        <SortDialog
          key={`${book.id}:${sheet.id}`}
          sheet={sheet}
          selection={selection}
          direction={sortDirection}
          onClose={closeModal}
          onSort={sortSheet}
        />
      )}
      {modal === 'new' && (
        <Modal
          title="开启新的可能"
          subtitle="从空白工作簿开始，或让模板帮您迈出第一步。"
          onClose={closeModal}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addBook(createBlankWorkbook(nameInput.trim() || '未命名工作簿'));
            }}
          >
            <label className="field-label">
              工作簿名称
              <input
                autoFocus
                placeholder="例如：2026 季度销售计划"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={80}
              />
            </label>
            <button className="create-blank-card" type="submit">
              <span>
                <FilePlus2 size={26} />
              </span>
              <div>
                <strong>空白工作簿</strong>
                <p>一张空白表格，无限种可能</p>
              </div>
              <ArrowRight size={18} />
            </button>
            <button
              className="create-blank-card template-link"
              type="button"
              onClick={() => setModal('templates')}
            >
              <span>
                <LayoutTemplate size={26} />
              </span>
              <div>
                <strong>从模板开始</strong>
                <p>为真实业务打造的专业模板</p>
              </div>
              <ArrowRight size={18} />
            </button>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={closeModal}>
                取消
              </button>
              <button type="submit" className="button primary">
                <Plus size={15} />
                创建工作簿
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'rename' && (
        <Modal title="重命名工作簿" onClose={closeModal}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nameInput.trim()) {
                updateBook({ ...book, name: nameInput.trim() });
                closeModal();
              }
            }}
          >
            <label className="field-label">
              工作簿名称
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={80}
              />
            </label>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={closeModal}>
                取消
              </button>
              <button className="button primary" disabled={!nameInput.trim()}>
                保存名称
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'templates' && (
        <Modal
          title="好工作，从好模板开始"
          subtitle="精心设计的业务模板，打开就能开始。所有示例数据均可自由修改。"
          onClose={closeModal}
          wide
        >
          <div className="template-categories" role="tablist" aria-label="模板分类">
            {['精选模板', '财务管理', '业务运营', '项目协作'].map((category) => (
              <button
                role="tab"
                aria-selected={templateFilter === category}
                className={templateFilter === category ? 'active' : ''}
                key={category}
                onClick={() => setTemplateFilter(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <div className="template-grid">
            {templates
              .filter(
                (t) =>
                  templateFilter === '精选模板' ||
                  (templateFilter === '财务管理' && ['finance', 'budget'].includes(t.id)) ||
                  (templateFilter === '业务运营' && t.id === 'sales') ||
                  (templateFilter === '项目协作' && t.id === 'project'),
              )
              .map((t) => (
                <button
                  className="template-card"
                  key={t.id}
                  onClick={() => addBook(createTemplateWorkbook(t.id))}
                >
                  <div className={`template-preview ${t.color}`}>
                    <div className="preview-topline">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="preview-heading">
                      <t.icon size={19} />
                      {t.name}
                    </div>
                    <div className="preview-minicards">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="preview-table">
                      {Array.from({ length: 20 }, (_, i) => (
                        <span key={i} />
                      ))}
                    </div>
                    <span className="template-open">
                      使用模板 <ArrowUpRight size={15} />
                    </span>
                  </div>
                  <div className="template-caption">
                    <span>{t.tag}</span>
                    <h3>{t.name}</h3>
                    <p>{t.description}</p>
                  </div>
                </button>
              ))}
          </div>
          <div className="template-bottom">
            <ShieldCheck size={15} />
            无需上传数据，所有计算在浏览器内完成。
          </div>
        </Modal>
      )}
      {modal === 'share' && (
        <Modal
          title="让数据，连接更多可能"
          subtitle="分享当前工作簿的独立副本，对方的修改不会影响您的原始数据。"
          onClose={closeModal}
        >
          <div className="share-document">
            <span className="document-icon">
              <FileSpreadsheet size={25} />
            </span>
            <div>
              <strong>{book.name}</strong>
              <p>{book.sheets.length} 个工作表 · 完整数据与样式</p>
            </div>
            <LockKeyhole size={17} />
          </div>
          <div className="share-info">
            <Link2 size={19} />
            <div>
              <strong>快照链接</strong>
              <p>
                链接包含当前工作簿数据。任何获得链接、且能够访问当前部署地址的人，都可以打开并保存副本。
              </p>
            </div>
          </div>
          {sharedUrl && (
            <input className="share-url" aria-label="共享快照链接" value={sharedUrl} readOnly />
          )}
          <button
            className="button primary full-width"
            onClick={async () => {
              try {
                const url = snapshotLink(book);
                setSharedUrl(url);
                await navigator.clipboard.writeText(url);
                notify('快照链接已复制');
              } catch (error) {
                notify(error instanceof Error ? error.message : '请手动复制链接');
              }
            }}
          >
            <Copy size={16} />
            {sharedUrl ? '再次复制快照链接' : '生成并复制快照链接'}
          </button>
          <div className="share-divider">
            <span />
            或使用文件分享
            <span />
          </div>
          <button className="button secondary full-width" onClick={() => handleExport('xlsx')}>
            <Download size={16} />
            下载 Excel 工作簿
          </button>
          <p className="modal-footnote">当前为本地工作空间；快照不包含实时协同或访问权限管理。</p>
        </Modal>
      )}
      {modal === 'history' && (
        <Modal
          title="每一步，都有迹可循"
          subtitle="保存重要节点，随时恢复到熟悉的版本。最多保留 20 个本地版本。"
          onClose={closeModal}
        >
          <div className="history-current">
            <span className="history-dot" />
            <div>
              <strong>当前版本</strong>
              <p>最后编辑于 {dateTime(book.updatedAt)}</p>
            </div>
            <button className="button primary" onClick={saveVersion}>
              <Plus size={15} />
              保存版本
            </button>
          </div>
          {revisions.length ? (
            <div className="history-list">
              {revisions.map((r) => (
                <div className="history-item" key={r.id}>
                  <History size={18} />
                  <div>
                    <strong>{r.name}</strong>
                    <p>
                      {r.workbook.sheets.length} 个工作表 · {dateTime(r.createdAt)}
                    </p>
                  </div>
                  <button
                    className="button secondary compact"
                    onClick={() => {
                      updateBook(structuredClone(r.workbook));
                      notify('已恢复版本，可通过撤销回到之前的内容');
                      closeModal();
                    }}
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <History size={32} />
              <h3>为重要时刻留一份备份</h3>
              <p>点击“保存版本”，创建第一个恢复点。</p>
            </div>
          )}
        </Modal>
      )}
      {modal === 'comments' && (
        <Modal
          title="把想法留在数据旁"
          subtitle={`当前单元格：${sheet.name} · ${cellKey(selection.row, selection.col)}`}
          onClose={closeModal}
        >
          <div className="comments-list">
            {comments.filter((c) => !c.resolved).length ? (
              comments
                .filter((c) => !c.resolved)
                .map((c) => (
                  <div className="comment" key={c.id}>
                    <span className="user-avatar small">我</span>
                    <div>
                      <div>
                        <strong>我</strong>
                        <time>{dateTime(c.createdAt)}</time>
                      </div>
                      <button
                        className="comment-cell"
                        onClick={() => {
                          selectSheet(c.sheetId);
                          const p = parseCellKey(c.cell);
                          if (p) setSelection(p);
                          closeModal();
                        }}
                      >
                        {book.sheets.find((s) => s.id === c.sheetId)?.name} · {c.cell}
                      </button>
                      <p>{c.text}</p>
                      <button
                        className="resolve-comment"
                        onClick={() => {
                          const next = comments.map((item) =>
                            item.id === c.id ? { ...item, resolved: true } : item,
                          );
                          setComments(next);
                          void persistence.current.saveComments(book.id, next);
                        }}
                      >
                        <Check size={13} />
                        标记已解决
                      </button>
                    </div>
                  </div>
                ))
            ) : (
              <div className="empty-state compact">
                <MessageSquare size={30} />
                <h3>让每一个想法被看见</h3>
                <p>选中单元格，添加您的第一条批注。</p>
              </div>
            )}
          </div>
          <textarea
            className="comment-input"
            placeholder="记录想法、补充说明…"
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            maxLength={2000}
          />
          <div className="modal-footer">
            <span className="muted">批注保存在此浏览器</span>
            <button className="button primary" disabled={!commentInput.trim()} onClick={addComment}>
              添加批注
              <ArrowUpRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {modal === 'search' && (
        <Modal title="您的下一份灵感，在哪里？" onClose={closeModal}>
          <div className="global-search">
            <Search size={19} />
            <input
              autoFocus
              aria-label="搜索工作簿"
              placeholder="搜索工作簿名称…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="search-results">
            {books
              .filter((b) => b.name.toLowerCase().includes(globalSearch.toLowerCase()))
              .map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setActiveId(b.id);
                    setWorkspace('workspace');
                    setTab('sheet');
                    closeModal();
                  }}
                >
                  <FileSpreadsheet size={21} />
                  <div>
                    <strong>{b.name}</strong>
                    <span>
                      {b.sheets.length} 个工作表 · {dateTime(b.updatedAt)}
                    </span>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            {!books.some((b) => b.name.toLowerCase().includes(globalSearch.toLowerCase())) && (
              <p className="search-empty">未找到匹配的工作簿，换个关键词试试。</p>
            )}
          </div>
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal
          title="我的工作空间"
          subtitle="以更适合自己的方式，整理工作与灵感。"
          onClose={closeModal}
        >
          <div className="settings-profile">
            <span className="workspace-avatar large">L</span>
            <div>
              <strong>个人工作空间</strong>
              <p>本地模式 · 无需登录</p>
            </div>
            <span className="local-badge">免费使用</span>
          </div>
          <div className="settings-row">
            <div>
              <strong>表格网格线</strong>
              <p>在工作表中显示单元格边界</p>
            </div>
            <button
              className={`toggle ${showGrid ? 'on' : ''}`}
              aria-label="显示网格线"
              role="switch"
              aria-checked={showGrid}
              onClick={() => setShowGrid(!showGrid)}
            >
              <span />
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>数据洞察面板</strong>
              <p>在表格旁显示分析建议</p>
            </div>
            <button
              className={`toggle ${insights ? 'on' : ''}`}
              role="switch"
              aria-checked={insights}
              aria-label="显示数据洞察"
              onClick={() => setInsights(!insights)}
            >
              <span />
            </button>
          </div>
          <div className="storage-card">
            <ShieldCheck size={21} />
            <div>
              <strong>数据由您掌握</strong>
              <p>
                当前所有工作簿保存在当前浏览器。清除浏览器数据会移除本地记录，建议定期导出备份。
              </p>
            </div>
          </div>
          <button className="button secondary full-width" onClick={() => handleExport('json')}>
            <Download size={16} />
            备份当前工作簿
          </button>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="让每一次操作，都更顺手"
          subtitle="一套熟悉的表格习惯，一个更轻盈的工作空间。"
          onClose={closeModal}
        >
          <div className="shortcuts">
            {[
              ['编辑单元格', '双击 / 直接输入'],
              ['提交并向下移动', 'Enter'],
              ['提交并向右移动', 'Tab'],
              ['选择连续区域', 'Shift + 点击'],
              ['复制 / 粘贴区域', '⌘ C / ⌘ V'],
              ['清空选中内容', 'Delete'],
              ['撤销 / 重做', '⌘ Z / ⌘ ⇧ Z'],
              ['搜索工作簿', '⌘ K'],
              ['保存到本地', '⌘ S'],
            ].map(([a, b]) => (
              <div key={a}>
                <span>{a}</span>
                <kbd>{b}</kbd>
              </div>
            ))}
          </div>
          <div className="formula-tip">
            <span className="fx">ƒx</span>
            <div>
              <strong>让公式帮您处理复杂计算</strong>
              <p>试试 =SUM(D2:D13)、=AVERAGE(G2:G13) 或 =IF(H2&gt;=1,"已达标","待提升")</p>
            </div>
          </div>
          <p className="modal-footnote">
            支持常用计算、跨表引用与 Excel / CSV / JSON 文件。宏、复杂图表和 Excel
            高级对象不在当前兼容范围内。
          </p>
        </Modal>
      )}
      {modal === 'plans' && (
        <Modal
          title="让每一份数据，都更有价值"
          subtitle="Lumina 灵表 · 一个正在生长的数据工作空间"
          onClose={closeModal}
        >
          <div className="product-intro">
            <span className="brand-mark large">
              <span />
              <span />
              <span />
              <span />
            </span>
            <h3>从第一格数据，到下一个好决策。</h3>
            <p>
              专注于更轻盈的编辑、更清晰的分析，
              <br />
              和让人愿意每天打开的表格体验。
            </p>
          </div>
          <div className="feature-checks">
            {[
              '表格编辑、常用公式与跨表计算',
              'Excel、CSV 和 JSON 导入导出',
              '联动经营看板与本地数据洞察',
              '工作簿模板、批注与版本恢复',
            ].map((s) => (
              <div key={s}>
                <CheckCircle2 size={17} />
                {s}
              </div>
            ))}
          </div>
          <div className="roadmap-note">
            <strong>当前版本：本地预览版</strong>
            <p>
              实时多人协作、企业身份认证、云端权限与订阅支付尚未接入。当前版本无需付费，可完整体验已开放的本地功能。
            </p>
          </div>
          <button className="button primary full-width" onClick={() => setModal('templates')}>
            从一份好模板开始
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
