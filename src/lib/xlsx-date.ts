/** Convert an ISO calendar date to Excel's 1900 serial without local-time parsing. */
export function xlsxIsoDateSerial(text: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      text.trim(),
    );
  const fail = (): never => {
    throw new Error('XLSX 日期文本无效或超出支持的 ISO 日期范围。');
  };
  if (!match) return fail();
  const [, y, m, d, h = '0', min = '0', s = '0', fraction = '', zone = 'Z'] = match;
  const year = Number(y),
    month = Number(m),
    day = Number(d);
  const hour = Number(h),
    minute = Number(min),
    second = Number(s) + Number(fraction || 0);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 24 ||
    minute > 59 ||
    second >= 60 ||
    (hour === 24 && (minute !== 0 || second !== 0))
  )
    return fail();
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return fail();
  let offset = 0;
  if (zone !== 'Z') {
    const zh = Number(zone.slice(1, 3)),
      zm = Number(zone.slice(4));
    if (zh > 14 || zm > 59 || (zh === 14 && zm !== 0)) return fail();
    offset = (zh * 60 + zm) * (zone[0] === '+' ? 1 : -1);
  }
  // Unzoned values use their written calendar/time; explicit zones normalize to UTC.
  const days =
    (date.getTime() - Date.UTC(1899, 11, 31)) / 86400000 +
    (hour * 3600 + minute * 60 + second - offset * 60) / 86400;
  return days >= 60 ? days + 1 : days;
}
