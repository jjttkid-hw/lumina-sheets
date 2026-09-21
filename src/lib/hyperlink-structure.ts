import { rewriteFormulaReferences, type FormulaStructureContext } from './formula-structure';
import { parseCellKey } from './engine';

export function rewriteSortedHyperlink(
  target: string,
  sourceName: string,
  targetName: string,
  rows: ReadonlyMap<number, number>,
): string {
  const match =
    /^#(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!)?(\$?[A-Za-z]{1,3}\$?[1-9]\d*)$/u.exec(
      target,
    );
  if (!match) return target;
  const name = match[1]?.replaceAll("''", "'") ?? match[2] ?? sourceName;
  if (name.toLocaleLowerCase() !== targetName.toLocaleLowerCase()) return target;
  const point = parseCellKey(match[3]);
  if (!point) return target;
  const row = rows.get(point.row);
  if (row === undefined || row === point.row) return target;
  return target.replace(/[1-9]\d*$/, String(row + 1));
}

/** Only local A1 destinations participate in structural reference tracking. */
export function rewriteHyperlinkTarget(target: string, context: FormulaStructureContext): string {
  if (!target.startsWith('#') || target === '#REF!') return target;
  const reference = target.slice(1);
  if (
    !/^(?:(?:'(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)!)?\$?[A-Za-z]{1,3}\$?[1-9]\d*$/u.test(
      reference,
    )
  )
    return target;
  const rewritten = rewriteFormulaReferences(`=${reference}`, context).slice(1);
  return rewritten.endsWith('#REF!') ? '#REF!' : `#${rewritten}`;
}
