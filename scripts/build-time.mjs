import { execFileSync } from 'node:child_process';

export function sourceTimestamp(epoch) {
  if (typeof epoch !== 'string' || /[^0-9]/.test(epoch) || !/^(0|[1-9][0-9]*)$/.test(epoch))
    throw new Error('SOURCE_DATE_EPOCH must contain integer Unix seconds');
  const milliseconds = Number(epoch) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 8_640_000_000_000_000)
    throw new Error('SOURCE_DATE_EPOCH is out of range');
  return new Date(milliseconds).toISOString();
}

export function buildTimestamp(root) {
  if (process.env.SOURCE_DATE_EPOCH !== undefined)
    return {
      timestamp: sourceTimestamp(process.env.SOURCE_DATE_EPOCH),
      source: 'SOURCE_DATE_EPOCH',
    };
  try {
    const epoch = execFileSync('git', ['log', '-1', '--format=%ct'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { timestamp: sourceTimestamp(epoch), source: 'git-commit' };
  } catch {
    return { timestamp: null, source: 'unavailable' };
  }
}
