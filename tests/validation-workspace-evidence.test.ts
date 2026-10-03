import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Node browser evidence verifier is not an SDK module
import { verifyValidationWorkspaceEvidence } from '../scripts/validation-workspace-evidence.mjs';

const root = 'docs/acceptance/workspace-validation-2026-10-03-r35/chromium';
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
describe('workspace rule browser evidence integrity', () => {
  it('verifies retained downloads and rejects missing, tampered or rehashed wrong content', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lumina-rule-evidence-'));
    try {
      await cp(root, folder, { recursive: true });
      const report = JSON.parse(await readFile(path.join(folder, 'result.json'), 'utf8'));
      const identity = Object.fromEntries(
        ['version', 'engine', 'siteSha256', 'artifactSha256', 'fixtureSha256'].map((key) => [
          key,
          report[key],
        ]),
      );
      const verify = () => verifyValidationWorkspaceEvidence(folder, identity);
      await expect(verify()).resolves.toMatchObject({ checks: 6, downloads: 7 });
      const originalReport = JSON.stringify(report);
      const resultFile = path.join(folder, 'result.json');
      report.checks.pop();
      await writeFile(resultFile, JSON.stringify(report));
      await expect(verify()).rejects.toThrow('Missing or duplicate');
      await writeFile(resultFile, originalReport);
      const file = path.join(folder, 'edited-title.json');
      const original = await readFile(file);
      await rm(file);
      await expect(verify()).rejects.toThrow('ENOENT');
      await writeFile(file, Buffer.concat([original, Buffer.from(' ')]));
      await expect(verify()).rejects.toThrow('Download digest');
      const workbook = JSON.parse(original.toString());
      workbook.sheets[2].dataValidations[0].errorTitle = '静默丢失后的标题';
      const changed = JSON.stringify(workbook);
      const restoredReport = JSON.parse(originalReport);
      restoredReport.checks[2].details.downloads[1].sha256 = hash(changed);
      await writeFile(file, changed);
      await writeFile(resultFile, JSON.stringify(restoredReport));
      await expect(verify()).rejects.toThrow('Rule title');
      await writeFile(file, original);
      await writeFile(resultFile, originalReport);
      const png = await readFile(path.join(folder, 'narrow.png'));
      png.writeUInt32BE(1440, 16);
      await writeFile(path.join(folder, 'narrow.png'), png);
      await expect(verify()).rejects.toThrow('Screenshot width');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
