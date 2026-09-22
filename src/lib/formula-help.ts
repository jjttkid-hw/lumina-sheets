/** User-facing syntax for the supported scalar formula subset. */
export const FORMULA_HELP = [
  ['SUM', 'number1, [number2], …', '求和'],
  ['AVERAGE', 'number1, [number2], …', '计算平均值'],
  ['MIN', 'number1, [number2], …', '返回最小值'],
  ['MAX', 'number1, [number2], …', '返回最大值'],
  ['COUNT', 'value1, [value2], …', '统计数字个数'],
  ['COUNTA', 'value1, [value2], …', '统计非空值'],
  ['SUMIF', 'range, criteria, [sum_range]', '按一个条件求和'],
  ['COUNTIF', 'range, criteria', '按一个条件计数'],
  ['SUMIFS', 'sum_range, criteria_range1, criteria1, …', '按多个条件求和'],
  ['COUNTIFS', 'criteria_range1, criteria1, …', '按多个条件计数'],
  ['SUMPRODUCT', 'array1, [array2], …', '对同形范围逐项相乘后求和'],
  ['IF', 'condition, value_if_true, [value_if_false]', '根据条件选择结果'],
  ['IFERROR', 'value, value_if_error', '公式出错时返回备用结果'],
  ['AND', 'logical1, [logical2], …', '所有条件都成立'],
  ['OR', 'logical1, [logical2], …', '任一条件成立'],
  ['NOT', 'logical', '反转逻辑值'],
  ['VLOOKUP', 'lookup_value, table, col_index, [range_lookup]', '按首列查找；精确查找请填 FALSE'],
  ['INDEX', 'array, row_num, [column_num]', '返回范围中的单个值'],
  ['MATCH', 'lookup_value, lookup_array, [match_type]', '返回匹配位置；精确查找请填 0'],
  [
    'XLOOKUP',
    'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]',
    '查找一维范围中的对应值；match_mode 为 2 时启用通配符',
  ],
  ['ROUND', 'number, num_digits', '四舍五入'],
  ['ROUNDUP', 'number, num_digits', '远离零方向舍入'],
  ['ROUNDDOWN', 'number, num_digits', '朝零方向舍入'],
  ['MOD', 'number, divisor', '返回与除数同号的余数'],
  ['INT', 'number', '向下取整'],
  ['ABS', 'number', '返回绝对值'],
  ['LEN', 'text', '返回 UTF-16 文本长度'],
  ['UPPER', 'text', '转换为大写'],
  ['LOWER', 'text', '转换为小写'],
  ['CONCAT', 'text1, [text2], …', '连接文本和范围内容'],
  ['CONCATENATE', 'text1, [text2], …', '连接文本和范围内容'],
  ['LEFT', 'text, [num_chars]', '从左提取文本；默认长度 1'],
  ['RIGHT', 'text, [num_chars]', '从右提取文本；默认长度 1'],
  ['MID', 'text, start_num, num_chars', '从指定位置提取文本；位置从 1 开始'],
  ['TRIM', 'text', '清除首尾 ASCII 空格并合并连续空格'],
  ['CLEAN', 'text', '删除 ASCII 控制字符'],
  ['FIND', 'find_text, within_text, [start_num]', '区分大小写查找文本；返回从 1 开始的位置'],
  ['REPLACE', 'old_text, start_num, num_chars, new_text', '替换指定位置的一段文本'],
  ['SUBSTITUTE', 'text, old_text, new_text, [instance_num]', '替换全部或指定次序的文本匹配'],
  ['TODAY', '', '返回本地今天的日期序列'],
  ['DATE', 'year, month, day', '构造 1900 日期系统的日期'],
  ['DATEVALUE', 'date_text', '解析 YYYY-MM-DD 日期'],
  ['YEAR', 'date', '提取年份'],
  ['MONTH', 'date', '提取月份'],
  ['DAY', 'date', '提取日'],
  ['DAYS', 'end_date, start_date', '计算日期间隔天数'],
  ['EOMONTH', 'start_date, months', '返回偏移月份的月末日期'],
  ['PMT', 'rate, nper, pv, [fv], [type]', '计算每期付款；利率与期数使用同一周期'],
  ['PV', 'rate, nper, pmt, [fv], [type]', '计算现值'],
  ['FV', 'rate, nper, pmt, [pv], [type]', '计算终值'],
  ['NPV', 'rate, value1, [value2], …', '计算期末现金流净现值；期初投资在函数外加上'],
  ['NPER', 'rate, pmt, pv, [fv], [type]', '计算所需期数；收付款使用相反符号'],
  ['IRR', 'values, [guess]', '计算等间隔现金流的内部收益率'],
  ['RATE', 'nper, pmt, pv, [fv], [type], [guess]', '计算等额现金流的周期利率'],
] as const;

/** Help for the leading function only; never treat strings or sheet names as calls. */
export function leadingFormulaHelp(draft: string) {
  const match = /^=\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(draft);
  if (!match) return undefined;
  const item = FORMULA_HELP.find(([name]) => name === match[1].toUpperCase());
  return item
    ? { name: item[0], syntax: `${item[0]}(${item[1]})`, description: item[2] }
    : undefined;
}
