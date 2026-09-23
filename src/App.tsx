import { parseCellInput } from './lib/cell-input';
import { downloadRecoveryBackup } from './lib/recovery-download';
import { readCurrentTrash, assertTrashSource, withTrashLock } from './lib/trash-storage';
import { assertCommentRecords, assertRevisionRecords } from './lib/auxiliary-records';
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
import { awaitFileOperation } from './lib/file-operation';
import { readUtf8File } from './lib/file-text';
import { independentWorkbookCopy as independentCopy, workbookCopyName } from './lib/workbook-copy';
import {
  readRecoveryImport,
  restoreRecoveryWorkbook,
  type RecoveryImport,
} from './lib/recovery-import';
import RecoveryDialog from './components/RecoveryDialog';
import { loadWorkbooks, readStored, writeStored, snapshotLink, readSnapshot } from './lib/storage';
import { getPersistence, type WorkbookPatch } from './lib/persistence';
import { WorkspaceSaveQueue } from './lib/workspace-save';
import { WorkspaceHistory } from './lib/workspace-history';
import { WorkspaceCalculationInputs, workspaceFormulaTargets } from './lib/workspace-calculation';
import { readSelectionStats, readSheetPopulation } from './lib/workspace-stats';
import { createCalculationRuntime } from './lib/calculation';
import { planWorkbookRowSort } from './lib/workbook-sort';
import type { RowSortRequest } from './lib/row-sort';
import SortDialog from './components/SortDialog';
import ValidationDialog from './components/ValidationDialog';
import StructureDialog from './components/StructureDialog';
import { planStructureEdit } from './lib/structure-edit';
import type { StructureEdit } from './lib/formula-structure';
import FormulaBar from './components/FormulaBar';
import HyperlinkDialog from './components/HyperlinkDialog';
import RichTextDialog from './components/RichTextDialog';
import SheetRenameDialog from './components/SheetRenameDialog';
import { planSheetRename } from './lib/sheet-rename';
import { replaceCellText } from './lib/rich-text';
import { resolveInternalHyperlink } from './lib/hyperlink-navigation';
import { planWorkspaceCellChanges } from './lib/workspace-edit';
import { planWorkspaceValidationRules } from './lib/workspace-validation';
import type { DataValidationRule } from './lib/data-validation';
import { workspaceRoutes } from './lib/workspace-routes';
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
  | 'rename-sheet'
  | 'sort'
  | 'validation'
  | 'structure'
  | 'recovery'
  | 'hyperlink'
  | 'rich-text'
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

function initialWorkspace(): { books: Workbook[]; shared: boolean; invalidSnapshot: boolean } {
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
      copy.name = workbookCopyName(copy.name, ' · 共享副本');
      return { books: [copy, ...existing], shared: true, invalidSnapshot: false };
    }
  } catch {
    /* Invalid external snapshots do not replace local documents. */
  }
  return {
    books: existing.length ? existing : [createDemoWorkbook()],
    shared: false,
    invalidSnapshot: new URLSearchParams(location.hash.slice(1)).has('snapshot'),
  };
}
export default function App() {
  const [documents, setDocuments] = useState(initialWorkspace);
  const { books } = documents;
  const setBooks = useCallback((next: Workbook[] | ((previous: Workbook[]) => Workbook[])) => {
    setDocuments((previous) => ({
      ...previous,
      books: typeof next === 'function' ? next(previous.books) : next,
    }));
  }, []);
  const [activeId, setActiveId] = useState(() => {
    const saved = readStored<string>('activeWorkbook', '');
    return documents.shared ? books[0].id : books.some((b) => b.id === saved) ? saved : books[0].id;
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
  const [recoveryImport, setRecoveryImport] = useState<RecoveryImport | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const sortButton = useRef<HTMLButtonElement>(null);
  const sortDialogOpen = useRef(false);
  const validationButton = useRef<HTMLButtonElement>(null);
  const validationDialogOpen = useRef(false);
  const structureButton = useRef<HTMLButtonElement>(null);
  const structureDialogOpen = useRef(false);
  useEffect(() => {
    if (sortDialogOpen.current && modal !== 'sort') sortButton.current?.focus();
    sortDialogOpen.current = modal === 'sort';
    if (validationDialogOpen.current && modal !== 'validation') validationButton.current?.focus();
    validationDialogOpen.current = modal === 'validation';
    if (structureDialogOpen.current && modal !== 'structure') structureButton.current?.focus();
    structureDialogOpen.current = modal === 'structure';
  }, [modal]);
  const [templateFilter, setTemplateFilter] = useState('精选模板');
  const [menu, setMenu] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [toast, setToast] = useState(
    documents.invalidSnapshot ? '分享链接无效或已损坏，已打开本地工作空间。' : '',
  );
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'session' | 'error'>('saving');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const [workspaceLoadWarning, setWorkspaceLoadWarning] = useState('');
  const [startupBackupBusy, setStartupBackupBusy] = useState(false);
  const [startupBackupMessage, setStartupBackupMessage] = useState('');
  const startupBackupPending = useRef(false);
  const workspaceReadyRef = useRef(workspaceReady);
  workspaceReadyRef.current = workspaceReady;
  const [workspaceLoadAttempt, setWorkspaceLoadAttempt] = useState(0);
  const addressOwner = `${book.id}:${sheet.id}:${selection.row}:${selection.col}`;
  const selectedAddress = cellKey(selection.row, selection.col);
  const [addressDraft, setAddressDraft] = useState(() => ({
    owner: addressOwner,
    value: selectedAddress,
  }));
  // Reset with the selection render. A passive effect can run after the user
  // has already typed an address and overwrite it before Enter is handled.
  const address = addressDraft.owner === addressOwner ? addressDraft.value : selectedAddress;
  if (addressDraft.owner !== addressOwner)
    setAddressDraft({ owner: addressOwner, value: selectedAddress });
  const setAddress = (value: string) => setAddressDraft({ owner: addressOwner, value });
  const [nameInput, setNameInput] = useState('');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revisionStatus, setRevisionStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>(
    'loading',
  );
  const [revisionError, setRevisionError] = useState('');
  const revisionOwner = useRef({
    bookId: book.id,
    ready: false,
    saving: false,
    items: [] as Revision[],
  });
  const revisionWrites = useRef(new Map<string, Promise<void>>());
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [commentStatus, setCommentStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>(
    'loading',
  );
  const [commentError, setCommentError] = useState('');
  const commentOwner = useRef({
    bookId: book.id,
    ready: false,
    saving: false,
    items: [] as Comment[],
  });
  const commentWrites = useRef(new Map<string, Promise<void>>());
  const auxiliaryBook = useRef(book.id);
  auxiliaryBook.current = book.id;
  const historyRequest = useRef(0);
  const revisionEditorVersion = historyRequest.current;
  const commentsRequest = useRef(0);
  const commentEditorVersion = commentsRequest.current;
  const [sharedUrl, setSharedUrl] = useState('');
  const [trash, setTrash] = useState<Workbook[]>([]);
  const [restoringTrash, setRestoringTrash] = useState(false);
  const trashRestorePending = useRef(false);
  const editHistory = useRef(new WorkspaceHistory(60));
  const [, refreshHistory] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileOperations, setFileOperations] = useState(0);
  const busy = fileOperations > 0;
  const fileOperationOwner = useRef({ mounted: true, importId: 0 });
  const fileRequests = useRef(new Set<AbortController>());
  const importRequest = useRef<AbortController | null>(null);
  const latestBooks = useRef(books);
  latestBooks.current = books;
  useEffect(() => {
    fileOperationOwner.current.mounted = true;
    return () => {
      fileOperationOwner.current.mounted = false;
      fileOperationOwner.current.importId++;
      const pending = [...fileRequests.current];
      fileRequests.current.clear();
      for (const request of pending) request.abort();
    };
  }, []);
  const persistence = useRef(getPersistence());
  const saveQueue = useRef<WorkspaceSaveQueue | null>(null);
  if (!saveQueue.current) saveQueue.current = new WorkspaceSaveQueue(persistence.current);
  const saveRevision = useRef(0);
  const saveRisk = useRef(false);
  const canvasDraftRisk = useRef(false);
  const formulaDraftRisk = useRef(false);
  const setCanvasDraftRisk = useCallback((dirty: boolean) => {
    canvasDraftRisk.current = dirty;
  }, []);
  const setFormulaDraftRisk = useCallback((dirty: boolean) => {
    formulaDraftRisk.current = dirty;
  }, []);
  const recordSave = useCallback((pending: Promise<void>) => {
    const revision = ++saveRevision.current;
    saveRisk.current = true;
    setSaveState('saving');
    void pending
      .then(() => {
        if (revision === saveRevision.current) {
          saveRisk.current = persistence.current.stats.backend === 'memory';
          if (fileOperationOwner.current.mounted)
            setSaveState(saveRisk.current ? 'session' : 'saved');
        }
      })
      .catch(() => {
        if (revision === saveRevision.current && fileOperationOwner.current.mounted)
          setSaveState('error');
      });
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !saveRisk.current &&
        !canvasDraftRisk.current &&
        !formulaDraftRisk.current &&
        !commentWrites.current.size &&
        !revisionWrites.current.size
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const calculation = useRef<ReturnType<typeof createCalculationRuntime> | null>(null);
  const calculationInputs = useRef(new WorkspaceCalculationInputs());
  const calculationInput = calculationInputs.current.get(book);
  const calculationVersion = calculationInput.revision;
  const [calculated, setCalculated] = useState<{
    revision: number;
    values: Record<string, CellValue>;
  }>({ revision: -1, values: {} });
  const renderEvaluator = useMemo(
    () => createEvaluator(calculationInput.workbook, { revision: calculationVersion }),
    [calculationInput],
  );
  const renderValue = useCallback(
    (targetSheet: Sheet, key: string): CellValue =>
      (calculated.revision === calculationVersion
        ? calculated.values[`${targetSheet.id}:${key}`]
        : undefined) ?? renderEvaluator(targetSheet, key),
    [calculated, calculationVersion, renderEvaluator],
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const selectedCell = sheet.cells[cellKey(selection.row, selection.col)];
  const hyperlinkOwner = useRef({
    book,
    sheet,
    selectedCell,
    key: cellKey(selection.row, selection.col),
    modal,
  });
  hyperlinkOwner.current = {
    book,
    sheet,
    selectedCell,
    key: cellKey(selection.row, selection.col),
    modal,
  };
  const currentHyperlinkOwner = hyperlinkOwner.current;
  const openedSnapshot = useRef(documents.shared);
  const requestedActiveId = useRef(readStored<string>('activeWorkbook', ''));
  useEffect(() => {
    let cancelled = false;
    setWorkspaceLoadFailed(false);
    setWorkspaceLoadError('');
    setWorkspaceLoadWarning('');
    void (async () => {
      try {
        const loaded = await persistence.current.loadWorkbooks();
        if (cancelled) return;
        if (!Array.isArray(loaded)) {
          setWorkspaceLoadError('工作簿目录损坏，请下载恢复备份并保留浏览器数据，修复后重试。');
          throw new Error('工作簿目录损坏');
        }
        let currentTrash: Workbook[];
        try {
          currentTrash = readCurrentTrash();
        } catch {
          setWorkspaceLoadError('回收站读取失败或目录损坏，请保留浏览器数据，修复后重试。');
          throw new Error('回收站读取失败');
        }
        setTrash(currentTrash);
        const archived = new Set(currentTrash.map((item) => item.id));
        let damagedCount = 0;
        const valid = loaded.flatMap((raw) => {
          try {
            const candidate = validateWorkbook(raw);
            return archived.has(candidate.id) ? [] : [candidate];
          } catch {
            damagedCount++;
            return [];
          }
        });
        if (damagedCount && !valid.length) {
          setWorkspaceLoadError(
            '工作簿内容损坏，无法安全打开。请下载恢复备份并保留浏览器数据，修复后重试。',
          );
          throw new Error('工作簿内容损坏');
        }
        if (damagedCount) {
          setWorkspaceLoadWarning(
            `${damagedCount} 本工作簿未能打开，原存储保持不变。请保留浏览器数据并下载恢复备份。`,
          );
        }
        const restored = valid.length ? valid : books.filter((item) => !archived.has(item.id));
        const readyBooks = openedSnapshot.current
          ? [books[0], ...restored.filter((item) => item.id !== books[0].id)]
          : restored.length
            ? restored
            : [createBlankWorkbook()];
        setBooks(readyBooks);
        setActiveId(
          openedSnapshot.current
            ? readyBooks[0].id
            : readyBooks.some((item) => item.id === requestedActiveId.current)
              ? requestedActiveId.current
              : readyBooks[0].id,
        );
        const storedIds = new Set(valid.map((item) => item.id));
        const newBooks = readyBooks.filter((item) => !storedIds.has(item.id));
        if (newBooks.length) {
          for (const initial of newBooks) recordSave(saveQueue.current!.snapshot(initial));
        } else recordSave(saveQueue.current!.flush());
        setWorkspaceReady(true);
      } catch (cause) {
        if (!cancelled) {
          setWorkspaceLoadError(
            (current) =>
              current ||
              (cause instanceof Error
                ? cause.message
                : '无法读取本地存储，请保留浏览器数据后重试。'),
          );
          setSaveState('error');
          setWorkspaceLoadFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceLoadAttempt]);
  useEffect(() => {
    const runtime = createCalculationRuntime({
      queueMode: 'latest',
      timeoutMs: 30_000,
      reuseSheets: true,
    });
    calculation.current = runtime;
    return () => {
      runtime.dispose();
      calculation.current = null;
    };
  }, []);
  useEffect(() => {
    const source = calculationInput.workbook;
    const targets = workspaceFormulaTargets(source);
    const revision = calculationVersion;
    let cancelled = false;
    // No formulas means no worker message or full workbook structured clone.
    if (!targets.length) {
      setCalculated({ revision, values: {} });
      return;
    }
    const controller = new AbortController();
    void calculation
      .current!.calculate(source, targets, revision, controller.signal)
      .then((result) => {
        if (!cancelled && result.revision === calculationVersion) {
          setCalculated({ revision: result.revision, values: result.values });
        }
      })
      .catch(() => {
        /* The synchronous evaluator remains the safe rendering fallback. */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [calculationInput]);
  useEffect(() => {
    if (workspaceReady) writeStored('activeWorkbook', activeId);
  }, [activeId, workspaceReady]);
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has('snapshot'))
      history.replaceState(null, '', location.pathname + location.search);
  }, []);
  useEffect(() => {
    if (!workspaceReady) return;
    setRevisions([]);
    setComments([]);
    setCommentInput('');
    loadCommentsForBook();
    loadVersionsForBook();
    editHistory.current.clear();
    setSelection({
      row: window.innerWidth <= 740 ? 0 : Math.min(1, sheet.rowCount - 1),
      col: window.innerWidth <= 740 ? 0 : Math.min(3, sheet.colCount - 1),
    });
    return () => {
      historyRequest.current++;
      commentsRequest.current++;
    };
  }, [book.id, workspaceReady]);
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
    (next: Workbook, track = true, patches?: WorkbookPatch[]) => {
      if (track) editHistory.current.record(book, patches);
      const committed = { ...next, updatedAt: new Date().toISOString() };
      calculationInputs.current.register(book, committed, patches);
      recordSave(
        patches
          ? saveQueue.current!.patches(book.id, patches)
          : saveQueue.current!.snapshot(committed),
      );
      setBooks((prev) => prev.map((b) => (b.id === book.id ? committed : b)));
      refreshHistory((n) => n + 1);
    },
    [book],
  );
  function changeSheet(next: Sheet): boolean {
    try {
      const previous = book.sheets.find((item) => item.id === next.id);
      if (!previous) throw new Error('找不到工作表');
      const keys =
        previous.cells === next.cells
          ? []
          : [...new Set([...Object.keys(previous.cells), ...Object.keys(next.cells)])];
      const changes = keys.flatMap((key) =>
        JSON.stringify(previous.cells[key]) === JSON.stringify(next.cells[key])
          ? []
          : [{ key, cell: next.cells[key] ?? null }],
      );
      const planned = planWorkspaceCellChanges(book, next.id, changes, {
        rowCount: next.rowCount,
        colCount: next.colCount,
      });
      const { cells: _beforeCells, ...beforeMeta } = previous;
      const { cells: _afterCells, ...afterMeta } = next;
      const metadataChanged = JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta);
      if (!planned && !metadataChanged) return true;
      // Both data and metadata are queued only after every candidate cell passed.
      const patches: WorkbookPatch[] = (planned?.changes ?? []).map((change) => ({
        kind: 'cell',
        sheetId: next.id,
        ...change,
      }));
      if (metadataChanged) {
        const changes = Object.fromEntries(
          [...new Set([...Object.keys(beforeMeta), ...Object.keys(afterMeta)])]
            .filter(
              (key) =>
                JSON.stringify(beforeMeta[key as keyof typeof beforeMeta]) !==
                JSON.stringify(afterMeta[key as keyof typeof afterMeta]),
            )
            .map((key) => [key, afterMeta[key as keyof typeof afterMeta]]),
        );
        patches.push({ kind: 'sheet-meta', sheetId: next.id, changes });
      }
      const result = { ...next, cells: planned?.sheet.cells ?? previous.cells };
      updateBook(
        { ...book, sheets: book.sheets.map((s) => (s.id === next.id ? result : s)) },
        true,
        patches,
      );
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : '修改未完成，请检查输入');
      return false;
    }
  }
  const applySheetPatches = useCallback(
    (
      sheetId: string,
      changes: Array<{ key: string; cell: import('./lib/types').Cell | null }>,
      dimensions?: { rowCount?: number; colCount?: number },
    ) => {
      const planned = planWorkspaceCellChanges(book, sheetId, changes, dimensions);
      if (!planned) return;
      const patches: WorkbookPatch[] = planned.changes.map((change) => ({
        kind: 'cell',
        sheetId,
        ...change,
      }));
      if (planned.dimensions)
        patches.push({ kind: 'sheet-meta', sheetId, changes: planned.dimensions });
      updateBook(
        {
          ...book,
          sheets: book.sheets.map((item) => (item.id === sheetId ? planned.sheet : item)),
        },
        true,
        patches,
      );
    },
    [book, updateBook],
  );
  function saveValidationRules(rules: DataValidationRule[]) {
    const next = planWorkspaceValidationRules(book, sheet.id, rules);
    if (next) {
      const patches: WorkbookPatch[] = [
        {
          kind: 'sheet-meta',
          sheetId: sheet.id,
          changes: { dataValidations: next.dataValidations },
        },
      ];
      updateBook(
        { ...book, sheets: book.sheets.map((item) => (item.id === sheet.id ? next : item)) },
        true,
        patches,
      );
    }
    closeModal();
    notify(next ? '数据验证规则已应用，可撤销；已有内容保持不变' : '规则没有变化');
  }
  function undo() {
    const previous = editHistory.current.undo(book);
    if (!previous) return;
    calculationInputs.current.register(book, previous.workbook, previous.patches);
    setBooks((prev) => prev.map((b) => (b.id === book.id ? previous.workbook : b)));
    recordSave(
      previous.patches
        ? saveQueue.current!.patches(book.id, previous.patches)
        : saveQueue.current!.snapshot(previous.workbook),
    );
    refreshHistory((n) => n + 1);
  }
  function redo() {
    const next = editHistory.current.redo(book);
    if (!next) return;
    calculationInputs.current.register(book, next.workbook, next.patches);
    setBooks((prev) => prev.map((b) => (b.id === book.id ? next.workbook : b)));
    recordSave(
      next.patches
        ? saveQueue.current!.patches(book.id, next.patches)
        : saveQueue.current!.snapshot(next.workbook),
    );
    refreshHistory((n) => n + 1);
  }
  function saveNow() {
    // Enqueue the current snapshot even while blocked, then explicitly retry the queue.
    void saveQueue.current!.snapshot(book).catch(() => undefined);
    const pending = saveQueue.current!.flush();
    recordSave(pending);
    void pending
      .then(() =>
        notify(
          persistence.current.stats.backend === 'memory'
            ? '当前仅保存在本次会话，请导出文件备份'
            : '工作簿已保存到本地',
        ),
      )
      .catch(() => notify('本地保存失败，请导出文件备份后重试'));
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const command = e.metaKey || e.ctrlKey,
        key = e.key.toLowerCase();
      if (command && key === 'k') {
        e.preventDefault();
        if (!modal) setModal('search');
      }
      if (command && key === 's') {
        e.preventDefault();
        if (workspaceReady) saveNow();
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
  }, [books, book, notify, modal, workspaceReady]);
  function addBook(next: Workbook, persist = true) {
    const unique = latestBooks.current.some((existing) => existing.id === next.id)
      ? independentCopy(next)
      : next;
    latestBooks.current = [unique, ...latestBooks.current];
    if (persist) recordSave(saveQueue.current!.snapshot(unique));
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
    const parsed = parseCellInput(value);
    if (sheet.cells[key]?.value === parsed) return;
    applySheetPatches(sheet.id, [{ key, cell: replaceCellText(sheet.cells[key], parsed) }]);
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
    const applied = changeSheet({
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
    if (!applied) return;
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
    const request = new AbortController();
    fileRequests.current.add(request);
    setFileOperations((count) => count + 1);
    try {
      await awaitFileOperation(
        exportWorkbook(structuredClone(book), format, { signal: request.signal }),
        request.signal,
      );
      if (fileOperationOwner.current.mounted && !request.signal.aborted)
        notify(`${format.toUpperCase()} 文件已导出`);
    } catch (error) {
      if (fileOperationOwner.current.mounted && !request.signal.aborted)
        notify(error instanceof Error ? error.message : '文件导出失败，请重试');
    } finally {
      finishFileOperation(request);
    }
  }
  function finishFileOperation(request: AbortController) {
    if (fileRequests.current.delete(request) && fileOperationOwner.current.mounted)
      setFileOperations((count) => count - 1);
    if (importRequest.current === request) importRequest.current = null;
  }
  function cancelFileOperations() {
    fileOperationOwner.current.importId++;
    const pending = [...fileRequests.current];
    fileRequests.current.clear();
    importRequest.current = null;
    setFileOperations(0);
    for (const request of pending) request.abort();
    if (fileInput.current) fileInput.current.value = '';
    notify('文件操作已取消，当前工作簿已保留');
  }
  async function handleImport(file?: File) {
    if (!file) return;
    setRecoveryImport(null);
    if (modal === 'recovery') closeModal();
    const importId = ++fileOperationOwner.current.importId;
    importRequest.current?.abort();
    const request = new AbortController();
    importRequest.current = request;
    fileRequests.current.add(request);
    const isCurrent = () =>
      fileOperationOwner.current.mounted &&
      fileOperationOwner.current.importId === importId &&
      !request.signal.aborted;
    setFileOperations((count) => count + 1);
    try {
      if (file.size > IMPORT_LIMITS.bytes) throw new Error('文件超过 20 MB 限制。');
      if (file.name.toLowerCase().endsWith('.json')) {
        const backup = readRecoveryImport(
          JSON.parse(await awaitFileOperation(readUtf8File(file, request.signal), request.signal)),
        );
        if (!isCurrent()) return;
        if (backup) {
          setRecoveryImport(backup);
          setModal('recovery');
          return;
        }
      }
      const result = await awaitFileOperation(importFile(file, request.signal), request.signal);
      if (!isCurrent()) return;
      addBook(result);
      notify(`已导入 ${result.name}`);
    } catch (error) {
      if (isCurrent()) notify(error instanceof Error ? error.message : '无法读取此文件');
    } finally {
      finishFileOperation(request);
      if (isCurrent() && fileInput.current) fileInput.current.value = '';
    }
  }
  function loadVersionsForBook() {
    const version = ++historyRequest.current;
    revisionOwner.current = { bookId: book.id, ready: false, saving: false, items: [] };
    setRevisionStatus('loading');
    setRevisionError('');
    const owns = () =>
      fileOperationOwner.current.mounted &&
      auxiliaryBook.current === book.id &&
      historyRequest.current === version;
    void (async () => {
      await revisionWrites.current.get(book.id)?.catch(() => {});
      if (!owns()) return;
      const items = await persistence.current.loadRevisions(book.id);
      if (!owns()) return;
      assertRevisionRecords(items);
      revisionOwner.current = { bookId: book.id, ready: true, saving: false, items };
      setRevisions(items);
      setRevisionStatus('ready');
    })().catch(() => {
      if (!owns()) return;
      setRevisionStatus('error');
      setRevisionError('版本历史读取失败，请重试读取后再保存。');
    });
  }
  function ownsVersionEditor() {
    const owner = revisionOwner.current;
    return (
      historyRequest.current === revisionEditorVersion &&
      auxiliaryBook.current === book.id &&
      owner.bookId === book.id &&
      owner.ready &&
      !owner.saving
    );
  }
  function saveVersion() {
    if (!ownsVersionEditor()) {
      if (auxiliaryBook.current === book.id) notify('版本历史尚未就绪，请打开版本历史查看状态。');
      return;
    }
    const owner = revisionOwner.current;
    const next = {
      id: crypto.randomUUID(),
      name: `手动保存 · ${dateTime(new Date().toISOString())}`,
      createdAt: new Date().toISOString(),
      workbook: structuredClone(book),
    };
    const list = [next, ...owner.items].slice(0, 20);
    owner.saving = true;
    const version = ++historyRequest.current;
    setRevisionStatus('saving');
    setRevisionError('');
    const owns = () =>
      fileOperationOwner.current.mounted &&
      auxiliaryBook.current === book.id &&
      historyRequest.current === version;
    const pending = Promise.resolve().then(() => persistence.current.saveRevisions(book.id, list));
    revisionWrites.current.set(book.id, pending);
    void pending
      .then(
        () => {
          if (!owns()) return;
          revisionOwner.current = { bookId: book.id, ready: true, saving: false, items: list };
          setRevisions(list);
          setRevisionStatus('ready');
          notify('已保存当前版本');
        },
        () => {
          if (!owns()) return;
          owner.saving = false;
          setRevisionStatus('ready');
          setRevisionError('版本保存失败，已有恢复点未更改；请重新保存或导出备份。');
          notify('版本保存失败，请打开版本历史重试或导出备份');
        },
      )
      .finally(() => {
        if (revisionWrites.current.get(book.id) === pending) revisionWrites.current.delete(book.id);
      });
  }
  function restoreVersion(revision: Revision) {
    if (!ownsVersionEditor()) return;
    try {
      if (revision.workbook.id !== book.id) throw new Error('恢复点不属于当前工作簿。');
      const candidate = validateWorkbook(revision.workbook);
      updateBook(candidate);
      notify('已恢复版本，可通过撤销回到之前的内容');
      closeModal();
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : '恢复点无效，未更改当前工作簿。');
    }
  }
  function openHistory() {
    if (!(revisionOwner.current.bookId === book.id && revisionOwner.current.saving))
      loadVersionsForBook();
    setModal('history');
  }
  async function archiveBook() {
    try {
      await withTrashLock(() => {
        if (!fileOperationOwner.current.mounted) return;
        const source = latestBooks.current.find((item) => item.id === book.id);
        if (!source) return;
        const current = readCurrentTrash();
        if (current.some((item) => item.id === source.id)) throw new Error('原件已归档');
        const next = [source, ...current];
        if (!writeStored('trash', next)) throw new Error('回收站写入失败');
        setTrash(next);
        const remaining = latestBooks.current.filter((item) => item.id !== source.id);
        const result = remaining.length ? remaining : [createBlankWorkbook()];
        if (!remaining.length) recordSave(saveQueue.current!.snapshot(result[0]));
        latestBooks.current = result;
        setBooks(result);
        setActiveId(result[0].id);
        setMenu(null);
        notify('已移到回收站，可随时恢复');
      });
    } catch {
      if (fileOperationOwner.current.mounted)
        notify('回收站读写失败或目录已变化，工作簿仍保留，请刷新后重试');
    }
  }
  async function backupFailedStartup() {
    if (startupBackupPending.current) return;
    startupBackupPending.current = true;
    setStartupBackupBusy(true);
    setStartupBackupMessage('');
    const readyAtStart = workspaceReadyRef.current;
    const current = () =>
      fileOperationOwner.current.mounted && workspaceReadyRef.current === readyAtStart;
    try {
      const message = await downloadRecoveryBackup(persistence.current, current);
      if (current() && message) setStartupBackupMessage(message);
    } catch {
      if (current()) setStartupBackupMessage('备份生成失败，请保留浏览器数据后重试。');
    } finally {
      startupBackupPending.current = false;
      if (fileOperationOwner.current.mounted) setStartupBackupBusy(false);
    }
  }
  async function restoreTrashBook(source: Workbook) {
    if (trashRestorePending.current) return;
    trashRestorePending.current = true;
    setRestoringTrash(true);
    try {
      assertTrashSource(readCurrentTrash(), source);
      const candidate = validateWorkbook(source);
      const restored = latestBooks.current.some((item) => item.id === candidate.id)
        ? independentCopy(candidate)
        : candidate;
      await saveQueue.current!.flush();
      const saving = saveQueue.current!.snapshot(restored);
      recordSave(saving);
      await saving;
      if (!fileOperationOwner.current.mounted) return;
      if (persistence.current.stats.backend === 'memory') {
        notify('当前仅内存会话，恢复内容未持久保存；回收站原件仍保留');
        return;
      }
      await withTrashLock(() => {
        if (!fileOperationOwner.current.mounted) return;
        if (latestBooks.current.some((item) => item.id === restored.id))
          throw new Error('恢复期间工作簿目录已变化，请重试');
        const current = readCurrentTrash();
        assertTrashSource(current, source);
        const remaining = current.filter((item) => item.id !== source.id);
        if (!writeStored('trash', remaining)) {
          notify('工作簿已保存，但回收站更新失败；原件仍保留，请重试恢复');
          return;
        }
        setTrash(remaining);
        addBook(restored, false);
        notify('工作簿已恢复');
      });
    } catch {
      if (fileOperationOwner.current.mounted) notify('恢复失败，回收站原件仍保留，请重试');
    } finally {
      trashRestorePending.current = false;
      if (fileOperationOwner.current.mounted) setRestoringTrash(false);
    }
  }
  function loadCommentsForBook() {
    const version = ++commentsRequest.current;
    commentOwner.current = { bookId: book.id, ready: false, saving: false, items: [] };
    setCommentStatus('loading');
    setCommentError('');
    const owns = () =>
      fileOperationOwner.current.mounted &&
      auxiliaryBook.current === book.id &&
      commentsRequest.current === version;
    void (async () => {
      // Returning to a workbook must not read the snapshot preceding its pending write.
      await commentWrites.current.get(book.id)?.catch(() => {});
      if (!owns()) return;
      const items = await persistence.current.loadComments(book.id);
      if (!owns()) return;
      assertCommentRecords(items);
      commentOwner.current = { bookId: book.id, ready: true, saving: false, items };
      setComments(items);
      setCommentStatus('ready');
    })().catch(() => {
      if (!owns()) return;
      setCommentStatus('error');
      setCommentError('批注读取失败，请重试读取后再编辑。');
    });
  }
  function saveCommentList(next: Comment[], added = false) {
    const owner = commentOwner.current;
    if (
      commentsRequest.current !== commentEditorVersion ||
      auxiliaryBook.current !== book.id ||
      owner.bookId !== book.id ||
      !owner.ready ||
      owner.saving
    )
      return;
    owner.saving = true;
    const version = ++commentsRequest.current;
    setCommentStatus('saving');
    setCommentError('');
    const owns = () =>
      fileOperationOwner.current.mounted &&
      auxiliaryBook.current === book.id &&
      commentsRequest.current === version;
    const pending = Promise.resolve().then(() => persistence.current.saveComments(book.id, next));
    commentWrites.current.set(book.id, pending);
    void pending
      .then(
        () => {
          if (!owns()) return;
          commentOwner.current = { bookId: book.id, ready: true, saving: false, items: next };
          setComments(next);
          setCommentStatus('ready');
          if (added) setCommentInput('');
          notify(added ? '批注已保存' : '批注已标记解决');
        },
        () => {
          if (!owns()) return;
          owner.saving = false;
          setCommentStatus('ready');
          setCommentError('批注保存失败，原批注未更改；请再次提交重试。');
        },
      )
      .finally(() => {
        if (commentWrites.current.get(book.id) === pending) commentWrites.current.delete(book.id);
      });
  }
  function addComment() {
    if (!commentInput.trim()) return;
    const next = [
      ...commentOwner.current.items,
      {
        id: crypto.randomUUID(),
        sheetId: sheet.id,
        cell: cellKey(selection.row, selection.col),
        text: commentInput.trim(),
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    ];
    saveCommentList(next, true);
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
    if (planned.relatedChanges?.length) {
      const groups = [{ sheetId: sheet.id, changes: planned.changes }, ...planned.relatedChanges];
      let candidate = book;
      const patches: WorkbookPatch[] = [];
      for (const group of groups) {
        const result = planWorkspaceCellChanges(candidate, group.sheetId, group.changes);
        if (!result) continue;
        candidate = {
          ...candidate,
          sheets: candidate.sheets.map((s) => (s.id === group.sheetId ? result.sheet : s)),
        };
        patches.push(
          ...result.changes.map((change): WorkbookPatch => ({
            kind: 'cell',
            sheetId: group.sheetId,
            ...change,
          })),
        );
      }
      if (patches.length) updateBook(candidate, true, patches);
    } else if (planned.changes.length) applySheetPatches(sheet.id, planned.changes);
    setModal(null);
    notify(
      planned.changes.length
        ? `已移动 ${planned.movedRows} 行，公式已保留 · 可一次撤销`
        : '当前顺序已符合条件，没有新增撤销记录',
    );
  }
  function editStructure(edit: StructureEdit) {
    const planned = planStructureEdit(book, sheet.id, edit);
    // The workspace has tighter persistence/import limits than the standalone SDK.
    const candidate = validateWorkbook({ ...book, sheets: planned.sheets });
    updateBook(candidate);
    const next = candidate.sheets.find((item) => item.id === sheet.id)!;
    setSelection({
      row: Math.min(edit.axis === 'row' ? edit.index : selection.row, next.rowCount - 1),
      col: Math.min(edit.axis === 'column' ? edit.index : selection.col, next.colCount - 1),
    });
    closeModal();
    notify(
      `已${edit.kind === 'insert' ? '插入' : '删除'} ${edit.count} ${edit.axis === 'row' ? '行' : '列'}，可一次撤销`,
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
      if (changeSheet({ ...sheet, merges: ranges.filter((merge) => merge !== existing) }))
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
      return (
        p &&
        p.row >= r1 &&
        p.row <= r2 &&
        p.col >= c1 &&
        p.col <= c2 &&
        (cell.value !== '' || cell.hyperlink !== undefined || cell.richText !== undefined)
      );
    });
    if (occupied.length > 1) {
      notify('为保留数据，请只合并最多包含一个有内容或链接的单元格的区域');
      return;
    }
    const cells = { ...sheet.cells },
      targetKey = cellKey(r1, c1);
    if (occupied.length === 1 && occupied[0][0] !== targetKey) {
      const [sourceKey, source] = occupied[0];
      cells[targetKey] = { ...cells[targetKey], ...source };
      // Move the link with its label; leaving it on the follower creates hidden
      // content that cannot be safely exported as an XLSX merged cell.
      cells[sourceKey] = { value: '', ...(source.style ? { style: source.style } : {}) };
    }
    const applied = changeSheet({
      ...sheet,
      cells,
      merges: [...ranges, { start: { row: r1, col: c1 }, end: { row: r2, col: c2 } }],
    });
    if (applied) setSelection({ row: r1, col: c1 });
  }
  // The value source survives presentation-only edits. Active-sheet identity is
  // separate because generic analytics follow the selected sheet.
  const statsSheet = calculationInput.workbook.sheets.find((item) => item.id === sheet.id)!;
  const population = useMemo(() => readSheetPopulation(statsSheet), [statsSheet]);
  const stats = useMemo(() => {
    const analysis = readWorkbookAnalytics({
        ...calculationInput.workbook,
        activeSheetId: sheet.id,
      }),
      revenue = analysis.rows.reduce((sum, row) => sum + row.revenue, 0),
      profit = analysis.hasProfit
        ? analysis.rows.reduce((sum, row) => sum + (row.profit ?? 0), 0)
        : null;
    return {
      revenue,
      profit,
      margin: profit !== null && revenue !== 0 ? profit / revenue : null,
      count: analysis.financial ? analysis.rows.length : population.rows,
      financial: analysis.financial,
      source: analysis.sheet?.name,
      hasCost: analysis.hasCost,
    };
  }, [calculationInput, sheet.id, population]);
  const selectedStats = useMemo(
    () => readSelectionStats(statsSheet, selection, renderEvaluator),
    [statsSheet, selection.row, selection.col, selection.endRow, selection.endCol, renderEvaluator],
  );
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
  if (!workspaceReady) {
    if (workspaceLoadFailed)
      return (
        <main className="workspace-startup" aria-labelledby="workspace-startup-title">
          <section className="workspace-startup-card">
            <p className="workspace-startup-eyebrow">本地数据恢复</p>
            <h1 id="workspace-startup-title">本地工作空间读取失败</h1>
            <p>尚未改动保存的数据。请先下载恢复备份，保留当前可读取的数据。</p>
            {workspaceLoadError && (
              <div className="workspace-startup-error" role="alert">
                <strong>读取错误</strong>
                <p>{workspaceLoadError}</p>
              </div>
            )}
            <div className="workspace-startup-actions">
              <button
                className="button primary"
                disabled={startupBackupBusy}
                onClick={() => void backupFailedStartup()}
              >
                {startupBackupBusy ? '正在准备恢复备份…' : '下载恢复备份'}
              </button>
              <button
                className="button"
                onClick={() => setWorkspaceLoadAttempt((value) => value + 1)}
              >
                重试读取
              </button>
            </div>
            <p className="workspace-startup-message" role="status" aria-live="polite">
              {startupBackupMessage}
            </p>
          </section>
        </main>
      );
    return (
      <div className="busy-indicator" role="status">
        <span />
        正在恢复本地工作空间…
      </div>
    );
  }
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
          <a className="nav-item" href={workspaceRoutes().report}>
            报表 JS 组件
          </a>
          <a className="nav-item" href={workspaceRoutes().performance}>
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
        {workspaceLoadWarning && (
          <div className="workspace-recovery-warning" role="status">
            <p>{workspaceLoadWarning}</p>
            <button
              className="button"
              disabled={startupBackupBusy}
              onClick={() => void backupFailedStartup()}
            >
              {startupBackupBusy ? '正在准备恢复备份…' : '下载恢复备份'}
            </button>
            {startupBackupMessage && <p>{startupBackupMessage}</p>}
          </div>
        )}
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
                  ? '保存失败'
                  : saveState === 'session'
                    ? '仅保存在本次会话'
                    : '已保存到本地'}
            </span>
            {saveState === 'error' && (
              <button className="button small" onClick={saveNow}>
                重试保存
              </button>
            )}
            <span className="topbar-divider" />
            <IconBtn label="版本历史" onClick={openHistory}>
              <History size={18} />
            </IconBtn>
            <IconBtn
              label="通知"
              onClick={() =>
                notify(
                  saveState === 'saved'
                    ? '所有更改已保存到当前浏览器'
                    : saveState === 'saving'
                      ? '正在保存最新更改'
                      : '更改尚未持久保存，请重试保存或导出备份',
                )
              }
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
                    disabled={restoringTrash}
                    onClick={() => void restoreTrashBook(b)}
                  >
                    {restoringTrash ? '正在恢复…' : '恢复工作簿'}
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
                          copy.name = workbookCopyName(copy.name, ' · 副本');
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
                      population.cells
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
                      if (!(commentOwner.current.bookId === book.id && commentOwner.current.saving))
                        loadCommentsForBook();
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
                        <IconBtn
                          label="撤销"
                          onClick={undo}
                          disabled={!editHistory.current.canUndo}
                        >
                          <Undo2 size={16} />
                        </IconBtn>
                        <IconBtn
                          label="重做"
                          onClick={redo}
                          disabled={!editHistory.current.canRedo}
                        >
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
                        <button
                          ref={structureButton}
                          type="button"
                          aria-label="插入或删除行列"
                          className="toolbar-text-button"
                          onClick={() => {
                            setMenu(null);
                            setModal('structure');
                          }}
                        >
                          <Table2 size={16} />
                          <span>行列</span>
                        </button>
                        <button
                          ref={validationButton}
                          type="button"
                          aria-label="数据验证"
                          title="数据验证：设置允许输入的内容"
                          className={`toolbar-text-button ${sheet.dataValidations?.length ? 'active' : ''}`}
                          onClick={() => {
                            setMenu(null);
                            setModal('validation');
                          }}
                        >
                          <ShieldCheck size={16} />
                          <span>数据验证</span>
                        </button>
                        <button
                          type="button"
                          aria-label="单元格链接"
                          className={`toolbar-text-button ${selectedCell?.hyperlink ? 'active' : ''}`}
                          disabled={sheet.dataSource?.kind === 'paged'}
                          onClick={() => {
                            setMenu(null);
                            setModal('hyperlink');
                          }}
                        >
                          链接
                        </button>
                        <button
                          type="button"
                          aria-label="局部文字格式"
                          title="选中文字设置局部字体和颜色"
                          className={`toolbar-text-button ${selectedCell?.richText ? 'active' : ''}`}
                          disabled={
                            sheet.dataSource?.kind === 'paged' ||
                            typeof selectedCell?.value !== 'string' ||
                            selectedCell.value.startsWith('=') ||
                            !selectedCell.value
                          }
                          onClick={() => {
                            setMenu(null);
                            setModal('rich-text');
                          }}
                        >
                          局部格式
                        </button>
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
                    <FormulaBar
                      readOnly={sheet.dataSource?.kind === 'paged'}
                      address={address}
                      onAddressChange={setAddress}
                      onAddressSubmit={() => {
                        const point = parseCellKey(address.toUpperCase());
                        if (point && point.row < sheet.rowCount && point.col < sheet.colCount)
                          setSelection(point);
                        else notify('请输入工作表范围内的地址，例如 D2');
                      }}
                      cellId={`${book.id}:${sheet.id}:${cellKey(selection.row, selection.col)}`}
                      value={String(selectedCell?.value ?? '')}
                      onCommit={setCellValue}
                      onDraftStateChange={setFormulaDraftRisk}
                    />
                    {sheet.dataSource?.kind === 'paged' && (
                      <div role="status" className="paged-snapshot-notice">
                        此表为分页数据快照，内容可能未完整加载。当前只读；请在原数据源导出完整文件。
                      </div>
                    )}
                    <div className="grid-container">
                      <Spreadsheet
                        workbook={book}
                        sheet={sheet}
                        readOnly={sheet.dataSource?.kind === 'paged'}
                        selection={selection}
                        onSelect={setSelection}
                        onChange={changeSheet}
                        onPatch={applySheetPatches}
                        onDraftStateChange={setCanvasDraftRisk}
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
                      <IconBtn
                        label="重命名当前工作表"
                        disabled={sheet.dataSource?.kind === 'paged'}
                        onClick={() => setModal('rename-sheet')}
                      >
                        <Type size={16} />
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
          <button type="button" onClick={cancelFileOperations}>
            取消文件操作
          </button>
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
      {modal === 'rich-text' && selectedCell && (
        <RichTextDialog
          key={`${book.id}:${sheet.id}:${cellKey(selection.row, selection.col)}:${JSON.stringify(selectedCell)}`}
          address={cellKey(selection.row, selection.col)}
          cell={selectedCell}
          onClose={() => {
            hyperlinkOwner.current = { ...hyperlinkOwner.current, modal: null };
            closeModal();
          }}
          onApply={(cell) => {
            if (
              hyperlinkOwner.current !== currentHyperlinkOwner ||
              hyperlinkOwner.current.modal !== 'rich-text'
            )
              throw new Error('当前单元格已变化，请重新打开局部格式编辑器。');
            if (cell.value !== selectedCell.value)
              throw new Error('局部格式不能修改文字，请返回表格编辑。');
            const candidate = { ...selectedCell };
            if (cell.richText === undefined) delete candidate.richText;
            else candidate.richText = cell.richText;
            applySheetPatches(sheet.id, [{ key: currentHyperlinkOwner.key, cell: candidate }]);
            hyperlinkOwner.current = { ...currentHyperlinkOwner, modal: null };
            closeModal();
          }}
        />
      )}
      {modal === 'hyperlink' && (
        <HyperlinkDialog
          key={`${book.id}:${sheet.id}:${cellKey(selection.row, selection.col)}:${JSON.stringify(selectedCell)}`}
          address={cellKey(selection.row, selection.col)}
          cell={selectedCell}
          onNavigate={() => {
            if (hyperlinkOwner.current !== currentHyperlinkOwner || !selectedCell?.hyperlink)
              throw new Error('当前单元格已变化，请重新打开链接编辑器。');
            const target = resolveInternalHyperlink(book, sheet.id, selectedCell.hyperlink.target);
            selectSheet(target.sheetId);
            setSelection({ row: target.row, col: target.col });
            setSearch('');
            setFilter('');
            setTab('sheet');
            hyperlinkOwner.current = { ...currentHyperlinkOwner, modal: null };
            closeModal();
          }}
          onClose={() => {
            hyperlinkOwner.current = { ...hyperlinkOwner.current, modal: null };
            closeModal();
          }}
          onApply={(cell) => {
            if (
              hyperlinkOwner.current !== currentHyperlinkOwner ||
              hyperlinkOwner.current.modal !== 'hyperlink'
            )
              throw new Error('当前单元格已变化，请重新打开链接编辑器。');
            applySheetPatches(sheet.id, [{ key: currentHyperlinkOwner.key, cell }]);
            hyperlinkOwner.current = { ...currentHyperlinkOwner, modal: null };
            closeModal();
          }}
        />
      )}
      {modal === 'structure' && (
        <StructureDialog
          key={`${book.id}:${sheet.id}`}
          sheet={sheet}
          selection={selection}
          onApply={editStructure}
          onClose={closeModal}
        />
      )}
      {modal === 'recovery' && recoveryImport && (
        <RecoveryDialog
          backup={recoveryImport}
          onClose={() => {
            closeModal();
            setRecoveryImport(null);
          }}
          onRestore={(index) => {
            const recovered = restoreRecoveryWorkbook(recoveryImport, index);
            addBook(recovered);
            setRecoveryImport(null);
            notify(`已恢复 ${recovered.name} 为独立副本，请确认保存状态`);
          }}
        />
      )}
      {modal === 'validation' && (
        <ValidationDialog
          key={`${book.id}:${sheet.id}`}
          sheet={sheet}
          selection={selection}
          onClose={closeModal}
          onSave={saveValidationRules}
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
      {modal === 'rename-sheet' && (
        <SheetRenameDialog
          key={`${book.id}:${sheet.id}:${sheet.name}`}
          name={sheet.name}
          onClose={() => {
            hyperlinkOwner.current = { ...hyperlinkOwner.current, modal: null };
            closeModal();
          }}
          onApply={(name) => {
            if (
              hyperlinkOwner.current !== currentHyperlinkOwner ||
              hyperlinkOwner.current.modal !== 'rename-sheet'
            )
              throw new Error('当前工作表已变化，请重新打开重命名窗口。');
            const candidate = planSheetRename(book, sheet.id, name);
            if (candidate !== book) updateBook(validateWorkbook(candidate));
            hyperlinkOwner.current = { ...currentHyperlinkOwner, modal: null };
            closeModal();
          }}
        />
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
          {revisionStatus === 'loading' && <p role="status">正在读取版本历史…</p>}
          {revisionStatus === 'saving' && <p role="status">正在保存版本…</p>}
          {revisionError && <p role="alert">{revisionError}</p>}
          {revisionStatus === 'error' && (
            <button className="button" onClick={loadVersionsForBook}>
              重试读取版本历史
            </button>
          )}
          <div className="history-current">
            <span className="history-dot" />
            <div>
              <strong>当前版本</strong>
              <p>最后编辑于 {dateTime(book.updatedAt)}</p>
            </div>
            <button
              className="button primary"
              disabled={revisionStatus !== 'ready'}
              onClick={saveVersion}
            >
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
                    disabled={revisionStatus !== 'ready'}
                    onClick={() => restoreVersion(r)}
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
          {commentStatus === 'loading' && <p role="status">正在读取批注…</p>}
          {commentStatus === 'saving' && <p role="status">正在保存批注…</p>}
          {commentError && <p role="alert">{commentError}</p>}
          {commentStatus === 'error' && (
            <button className="button" onClick={loadCommentsForBook}>
              重试读取批注
            </button>
          )}
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
                          try {
                            const point = parseCellKey(c.cell);
                            if (!point) throw new Error('批注目标单元格不存在。');
                            const target = resolveInternalHyperlink(
                              book,
                              c.sheetId,
                              `#${cellKey(point.row, point.col)}`,
                            );
                            selectSheet(target.sheetId);
                            setSelection({ row: target.row, col: target.col });
                            setSearch('');
                            setCommentError('');
                            closeModal();
                          } catch (error) {
                            setCommentError(
                              error instanceof Error ? error.message : '无法定位批注。',
                            );
                          }
                        }}
                      >
                        {book.sheets.find((s) => s.id === c.sheetId)?.name} · {c.cell}
                      </button>
                      <p>{c.text}</p>
                      <button
                        className="resolve-comment"
                        disabled={commentStatus !== 'ready'}
                        onClick={() => {
                          saveCommentList(
                            commentOwner.current.items.map((item) =>
                              item.id === c.id ? { ...item, resolved: true } : item,
                            ),
                          );
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
            disabled={commentStatus !== 'ready'}
            placeholder="记录想法、补充说明…"
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            maxLength={2000}
          />
          <div className="modal-footer">
            <span className="muted">批注保存在此浏览器</span>
            <button
              className="button primary"
              disabled={commentStatus !== 'ready' || !commentInput.trim()}
              onClick={addComment}
            >
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
