import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);
function fixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'lumina-api-contract-'));
  temporary.push(cwd);
  mkdirSync(path.join(cwd, 'dist/sdk/types'), { recursive: true });
  mkdirSync(path.join(cwd, 'docs'));
  const declaration = path.join(cwd, 'dist/sdk/types/index.d.ts');
  const manifest = path.join(cwd, 'dist/sdk/package.json');
  writeFileSync(
    declaration,
    'export declare class Grid { private internal; load(value: string): void; }',
  );
  writeFileSync(manifest, JSON.stringify({ exports: { '.': './index.js' } }));
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [path.resolve('scripts/check-api.mjs'), ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  return { cwd, declaration, manifest, run };
}
describe('public API declaration gate', () => {
  it('ignores private implementation and comments while preserving public contracts', () => {
    const { declaration, run } = fixture();
    run('--write');
    writeFileSync(
      declaration,
      '/** new comment */ export declare class Grid { private changed; private helper(): void; load(value: string): void; }',
    );
    expect(run()).toContain('contract passed');
  });
  it('rejects changed public signatures and never updates the baseline implicitly', () => {
    const { cwd, declaration, run } = fixture();
    run('--write');
    const before = readFileSync(path.join(cwd, 'docs/api-contract.json'), 'utf8');
    writeFileSync(declaration, 'export declare class Grid { load(value: number): void; }');
    expect(() => run()).toThrow();
    expect(readFileSync(path.join(cwd, 'docs/api-contract.json'), 'utf8')).toBe(before);
  });
  it('rejects changed package exports', () => {
    const { manifest, run } = fixture();
    run('--write');
    writeFileSync(manifest, JSON.stringify({ exports: { './internal': './index.js' } }));
    expect(() => run()).toThrow();
  });
  it('rejects an empty declaration graph or unsupported arguments', () => {
    const { declaration, run } = fixture();
    rmSync(declaration);
    expect(() => run('--write')).toThrow();
    expect(() => run('--approve')).toThrow();
  });
});
