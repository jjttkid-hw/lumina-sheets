import type { Cell } from './types';

/** Metadata only: retaining a target never authorizes executing or opening it. */
export function copyHyperlink(input: unknown, value: unknown): Cell['hyperlink'] {
  if (input === undefined) return undefined;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof value !== 'string' ||
    value.startsWith('=')
  )
    throw new Error('超链接仅支持普通文本单元格');
  const link = input as Record<string, unknown>;
  if (
    typeof link.target !== 'string' ||
    !link.target.trim() ||
    link.target.length > 32767 ||
    /[\u0000-\u001f\u007f]/.test(link.target) ||
    (link.tooltip !== undefined &&
      (typeof link.tooltip !== 'string' || link.tooltip.length > 32767)) ||
    Object.keys(link).some((key) => key !== 'target' && key !== 'tooltip')
  )
    throw new Error('超链接目标或提示文字无效');
  return {
    target: link.target,
    ...(link.tooltip !== undefined ? { tooltip: link.tooltip as string } : {}),
  };
}
