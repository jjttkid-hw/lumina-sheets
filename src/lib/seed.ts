import type { Cell, CellStyle, Sheet, Workbook } from './types';
import { cellKey } from './engine';

const header: CellStyle = { bold: true, background: '#edf3e8', color: '#5b7450', fontSize: 12 };
const currency: CellStyle = { format: 'number', align: 'right' };
const percentage: CellStyle = { format: 'percent', align: 'right' };
export const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function fromRows(name: string, rows: (string | number | boolean)[][], widths: number[]): Sheet {
  const cells: Record<string, Cell> = {};
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      cells[cellKey(r, c)] = { value, ...(r === 0 ? { style: { ...header } } : {}) };
    }),
  );
  return {
    id: makeId(),
    name,
    cells,
    rowCount: Math.max(100, rows.length + 20),
    colCount: Math.max(16, widths.length),
    frozenRows: 1,
    columnWidths: Object.fromEntries(widths.map((width, i) => [i, width])),
  };
}

function wrap(name: string, sheets: Sheet[], category = '经营分析'): Workbook {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    name,
    description: '在同一张表格里，让数据变成决策。',
    sheets,
    activeSheetId: sheets[0].id,
    createdAt: now,
    updatedAt: now,
    category,
    starred: false,
  };
}

export function createBlankWorkbook(name = '未命名工作簿'): Workbook {
  return wrap(name, [fromRows('工作表 1', [], Array(16).fill(120))], '我的工作簿');
}

export function createDemoWorkbook(): Workbook {
  const raw: (string | number)[][] = [
    ['1月', '云端协作', '林晓', 186000, 108000, 0.93, '已完成', '续约客户稳定增长'],
    ['1月', '企业服务', '陈舟', 248000, 152000, 1.08, '已完成', '华东区域新增 3 家客户'],
    ['2月', '数据智能', '许知远', 214000, 121000, 0.97, '已完成', '数据看板方案上线'],
    ['2月', '云端协作', '林晓', 208000, 116000, 1.04, '已完成', '团队版转化率提升'],
    ['3月', '企业服务', '陈舟', 312000, 181000, 1.12, '已完成', '完成重点客户交付'],
    ['3月', '数据智能', '许知远', 256000, 143000, 1.07, '已完成', '推出行业分析模板'],
    ['4月', '云端协作', '林晓', 275000, 154000, 1.1, '已完成', '自助订阅持续增长'],
    ['4月', '企业服务', '陈舟', 348000, 196000, 1.09, '已完成', '新增两家战略客户'],
    ['5月', '数据智能', '许知远', 326000, 178000, 1.16, '已完成', '智能分析模块扩容'],
    ['5月', '云端协作', '林晓', 298000, 162000, 0.96, '进行中', '企业版升级跟进中'],
    ['6月', '企业服务', '陈舟', 412000, 226000, 1.14, '进行中', '年度服务合同推进中'],
    ['6月', '数据智能', '许知远', 368000, 198000, 0.92, '待跟进', '重点商机待确认'],
  ];
  const revenueRows: (string | number)[][] = [
    [
      '月份',
      '产品线',
      '负责人',
      '营收（元）',
      '成本（元）',
      '利润（元）',
      '利润率',
      '完成率',
      '状态',
      '备注',
    ],
  ];
  raw.forEach((row, i) =>
    revenueRows.push([
      ...row.slice(0, 5),
      `=D${i + 2}-E${i + 2}`,
      `=IFERROR(F${i + 2}/D${i + 2},0)`,
      ...row.slice(5),
    ]),
  );
  const revenue = fromRows(
    '营收明细',
    revenueRows,
    [90, 125, 100, 125, 125, 125, 85, 110, 100, 220],
  );
  for (let r = 1; r <= 12; r++) {
    for (const c of [3, 4, 5])
      revenue.cells[cellKey(r, c)].style = {
        ...currency,
        ...(c === 5 ? { color: '#059669' } : {}),
      };
    for (const c of [6, 7]) revenue.cells[cellKey(r, c)].style = { ...percentage };
  }
  const targets = [450000, 460000, 550000, 600000, 650000, 780000];
  const goalRows: (string | number)[][] = [['月份', '目标营收', '实际营收', '达成率']];
  targets.forEach((target, i) =>
    goalRows.push([
      `${i + 1}月`,
      target,
      `=SUMIF('营收明细'!A2:A13,A${i + 2},'营收明细'!D2:D13)`,
      `=IFERROR(C${i + 2}/B${i + 2},0)`,
    ]),
  );
  const goals = fromRows('月度目标', goalRows, [120, 180, 180, 140]);
  for (let r = 1; r <= 6; r++) {
    for (const c of [1, 2]) goals.cells[cellKey(r, c)].style = { ...currency };
    goals.cells[cellKey(r, 3)].style = { ...percentage };
  }
  const budget = fromRows(
    '费用预算',
    [
      ['费用类别', '年度预算', '已使用', '剩余预算', '使用率', '负责人'],
      ['产品研发', 1800000, 824000, '=B2-C2', '=C2/B2', '周可'],
      ['市场推广', 680000, 296000, '=B3-C3', '=C3/B3', '沈一'],
      ['客户成功', 520000, 241000, '=B4-C4', '=C4/B4', '林晓'],
      ['行政办公', 260000, 117000, '=B5-C5', '=C5/B5', '何静'],
      ['云服务', 420000, 192000, '=B6-C6', '=C6/B6', '许知远'],
      ['合计', '=SUM(B2:B6)', '=SUM(C2:C6)', '=SUM(D2:D6)', '=C7/B7', ''],
    ],
    [160, 170, 170, 170, 120, 120],
  );
  for (let r = 1; r <= 6; r++) {
    for (const c of [1, 2, 3]) budget.cells[cellKey(r, c)].style = { ...currency };
    budget.cells[cellKey(r, 4)].style = { ...percentage };
  }
  for (let c = 0; c < 6; c++)
    budget.cells[cellKey(6, c)].style = {
      ...budget.cells[cellKey(6, c)].style,
      bold: true,
      background: '#f1f5f9',
    };
  const workbook = wrap('2026 年度经营分析', [revenue, goals, budget]);
  workbook.starred = true;
  workbook.id = `demo-${workbook.id}`;
  workbook.description = '营收、利润与预算，一目了然。';
  return workbook;
}

export function createTemplateWorkbook(type: string): Workbook {
  if (/revenue|finance|sales|经营|营收|财务|analysis/i.test(type)) {
    const book = createDemoWorkbook();
    book.id = makeId();
    book.starred = false;
    if (/sales/i.test(type)) book.name = '销售业绩分析';
    return book;
  }
  if (/project|项目/i.test(type))
    return wrap(
      '项目进度管理',
      [
        fromRows(
          '项目任务',
          [
            ['任务名称', '负责人', '优先级', '开始日期', '截止日期', '完成率', '状态', '备注'],
            [
              '用户需求调研',
              '林晓',
              '高',
              '2026-09-01',
              '2026-09-08',
              1,
              '已完成',
              '已整理用户访谈记录',
            ],
            [
              '产品方案设计',
              '陈舟',
              '高',
              '2026-09-08',
              '2026-09-18',
              0.8,
              '进行中',
              '等待评审反馈',
            ],
            [
              '前端功能开发',
              '周可',
              '中',
              '2026-09-15',
              '2026-09-30',
              0.35,
              '进行中',
              '基础功能已完成',
            ],
            ['测试与验收', '何静', '中', '2026-09-28', '2026-10-08', 0, '待跟进', '准备测试用例'],
          ],
          [220, 120, 100, 140, 140, 100, 110, 260],
        ),
      ],
      '项目管理',
    );
  if (/inventory|库存|进销存/i.test(type))
    return wrap(
      '库存管理',
      [
        fromRows(
          '库存台账',
          [
            [
              '商品编号',
              '商品名称',
              '分类',
              '期初库存',
              '本期入库',
              '本期出库',
              '当前库存',
              '安全库存',
              '状态',
            ],
            [
              'SKU-001',
              '无线机械键盘',
              '办公外设',
              120,
              80,
              95,
              '=D2+E2-F2',
              30,
              '=IF(G2<H2,"需要补货","正常")',
            ],
            [
              'SKU-002',
              '便携显示器',
              '办公设备',
              60,
              40,
              78,
              '=D3+E3-F3',
              25,
              '=IF(G3<H3,"需要补货","正常")',
            ],
            [
              'SKU-003',
              '多功能扩展坞',
              '数码配件',
              180,
              100,
              136,
              '=D4+E4-F4',
              40,
              '=IF(G4<H4,"需要补货","正常")',
            ],
          ],
          [140, 210, 130, 120, 120, 120, 120, 120, 140],
        ),
      ],
      '库存管理',
    );
  if (/budget|预算/i.test(type)) {
    const book = createDemoWorkbook();
    return wrap('年度预算规划', [book.sheets[2]], '财务预算');
  }
  return createBlankWorkbook(type === 'blank' ? '未命名工作簿' : `${type}工作簿`);
}
