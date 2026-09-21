# 数据验证

本模块对计算后的单元格值检查规则，适用于静态工作表的编辑约束。规则配置由 `copyDataValidationRules(input)` 严格校验并复制，检查使用 `checkValue(sheetId, key, computedValue, rules)`；返回所有失败的数组，空数组表示通过。它不会执行公式，也不会扫描或为范围中的每一格创建对象。

```js
import { copyDataValidationRules, checkValue } from './lumina.js';

const rules = copyDataValidationRules([
  {
    id: 'quantity',
    sheetId: 'sales',
    range: { start: { row: 1, col: 2 }, end: { row: 999, col: 2 } },
    kind: 'whole',
    operator: 'between',
    min: 1,
    max: 100,
    allowBlank: false,
    message: '数量须为 1 到 100 的整数',
  },
]);
const failures = checkValue('sales', 'C2', 101, rules);
// [{ ruleId:'quantity', sheetId:'sales', key:'C2', kind:'whole',
//    code:'OUT_OF_RANGE', message:'数量须为 1 到 100 的整数', value:101 }]
```

## 规则与类型

公共字段是稳定且在集合内唯一的 `id`、零基闭区间 `range`、可选 `sheetId`、`allowBlank` 和 `message`。不指定 `sheetId` 时，检查任意工作表上的对应范围。多个重叠规则必须全部通过，不会用后一个覆盖前一个。

| kind         | 允许的值                                   | 配置                              |
| ------------ | ------------------------------------------ | --------------------------------- |
| `list`       | 与列表严格同类型、同值、同大小写           | `values: CellValue[]`             |
| `whole`      | 有限且安全的整数，不接受数字文本或布尔值   | `operator` 与数值边界             |
| `decimal`    | 有限数字，整数也可；不接受数字文本或布尔值 | `operator` 与数值边界             |
| `textLength` | 仅文本，按 Unicode 码点数计长度            | `operator` 与 0–32,767 的整数边界 |

数值和长度运算符包括 `between`、`notBetween`、`equal`、`notEqual`、`greaterThan`、`greaterThanOrEqual`、`lessThan`、`lessThanOrEqual`。`between`/`notBetween` 要求 `min`、`max`，其余要求 `value`；不能混用参数。`between` 包含两个边界，`notBetween` 排除两个边界及中间区域。

只有空字符串 `''` 视为空白；`allowBlank` 默认 `true`。`false`、`0`、空格都不是空白。`allowBlank:false` 优先拒绝空字符串，即使列表包含 `''`。长度规则同样遵循空白策略，不能通过 `value:0` 绕过禁止空白。

长度按 Unicode **码点**计数：`中文` 为 2，`😀中` 为 2，`e` 加组合重音 `\u0301` 为 2。不会将组合字符或家庭 emoji 的多码点序列合并成一个可见字符，也不会自动做 Unicode 归一化。字符串存储长度限制仍按 UTF-16 代码单元计数，与工作簿单元格边界一致。

公式应先由调用者计算，再传入结果。例如 `=2*3` 的结果 `6` 能通过数值规则，公式源文本本身不能。公式错误是计算器返回的文本，数值规则会拒绝；模块不会凭文本内容猜测来源，也不会执行自定义公式或脚本。

## 边界与失败结果

每组最多 1,000 条规则，每条列表 1–1,000 项，全部列表合计最多 100,000 项。规则 ID 最多 100、工作表 ID 最多 200、提示文案最多 500 个 UTF-16 代码单元。范围必须位于 Excel 的 1,048,576 行、16,384 列内；不会展开范围。未知属性、重复 ID、缺少或冲突参数、无效类型都明确拒绝。

配置失败抛出 `DataValidationRuleError`，包含 `code:'INVALID_VALIDATION_RULE'`、`path` 和消息。值失败返回 `BLANK_NOT_ALLOWED`、`TYPE_MISMATCH`、`OUT_OF_RANGE` 或 `NOT_IN_LIST`，同时携带原值、规则 ID、工作表 ID 和规范化单元格地址。输出规则的列表与范围均为独立副本，修改调用者的输入不会改变已复制配置；持有输出后也应通过 SDK API 更新，不直接改内部配置。

SDK 将规则保存于工作表 JSON，面向静态编辑做原子批量验证。只有直接编辑的格会检查；未直接编辑的依赖公式和既有值可用 `validateCell` 显式检查。分页源为只读模式；本模块不把已有数据重新扫描为“已认证通过”。v0.16 的 Canvas 单格提供允许值选择浮层，支持搜索、键盘和长列表虚拟化；工作空间与 SDK 共用实现，行为见 [单元格选项](VALIDATION-PICKER.md)。

v0.5 支持 XLSX 数据验证的双向转换：整数、小数和文本长度规则采用常量数字边界，列表只接受受限内联文本。原始 OOXML 预读保持矩形范围，不让 ExcelJS 将大范围规则逐格展开，也不会把表达式误解析为常量。重叠规则、数字/布尔列表、引用列表、自定义公式、x14 扩展等超出子集时明确拒绝。

XLSX 不保留 SDK 自定义规则 ID，也不保证 Excel 输入转换、大小写、空白和 Unicode 长度行为与 SDK 相同。需要完整 SDK 类型和配置时使用 JSON。兼容范围、错误消息限制和安全导入顺序见 [XLSX-VALIDATION.md](XLSX-VALIDATION.md)；打印元数据子集见 [XLSX-PRINT.md](XLSX-PRINT.md)。第三方依赖复核见 [DEPENDENCIES.md](DEPENDENCIES.md)。这些实现不是完整 Excel 验证兼容层，也不代表商业授权审计已通过。
