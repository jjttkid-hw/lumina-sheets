/** Glob matching without a backtracking regular expression. The shared budget
 * bounds all values tested by one criterion, including a large range scan. */
export function compileWildcard(
  pattern: string,
  options: { unicode?: boolean; maxSteps?: number } = {},
) {
  const unicode = options.unicode ?? true;
  const characters = unicode ? [...pattern] : pattern.split('');
  const tokens: Array<'star' | 'any' | RegExp> = [];
  for (let i = 0; i < characters.length; i++) {
    let char = characters[i];
    if (char === '~' && i + 1 < characters.length) char = characters[++i];
    else if (char === '*') {
      if (tokens.at(-1) !== 'star') tokens.push('star');
      continue;
    } else if (char === '?') {
      tokens.push('any');
      continue;
    }
    tokens.push(
      new RegExp(`^${char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, unicode ? 'iu' : 'i'),
    );
  }
  let remaining = options.maxSteps ?? 20_000_000;
  const step = () => {
    if (--remaining < 0) throw new RangeError('Wildcard matching work limit exceeded');
  };
  return (text: string): boolean => {
    const input = unicode ? [...text] : text.split('');
    let at = 0,
      token = 0,
      star = -1,
      retry = 0;
    while (at < input.length) {
      step();
      const current = tokens[token];
      if (current === 'star') {
        star = token++;
        retry = at;
      } else if (current === 'any' || (current instanceof RegExp && current.test(input[at]))) {
        at++;
        token++;
      } else if (star >= 0) {
        token = star + 1;
        at = ++retry;
      } else return false;
    }
    while (tokens[token] === 'star') {
      step();
      token++;
    }
    return token === tokens.length;
  };
}
