import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceTimestamp } from './build-time.mjs';

const blockSize = 512;
function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  assert(bytes.length <= length, `Tar field is too long: ${value}`);
  bytes.copy(header, offset);
}
function writeOctal(header, offset, length, value) {
  assert(Number.isSafeInteger(value) && value >= 0, 'Tar numeric field must be a safe integer');
  const encoded = value.toString(8).padStart(length - 1, '0') + '\0';
  assert(encoded.length === length, `Tar numeric field is too large: ${value}`);
  header.write(encoded, offset, length, 'ascii');
}
function fileEntry(name, bytes, epochSeconds) {
  const header = Buffer.alloc(blockSize);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, bytes.length);
  writeOctal(header, 136, 12, epochSeconds);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((blockSize - (bytes.length % blockSize)) % blockSize);
  return [header, bytes, padding];
}

/** Create the exact npm package archive without platform-specific tar metadata. */
export async function deterministicPack(directory, files, destination, epoch) {
  sourceTimestamp(epoch);
  const epochSeconds = Number(epoch);
  const chunks = [];
  for (const relative of [...files].sort()) {
    assert(
      relative && !path.posix.isAbsolute(relative) && !relative.split('/').includes('..'),
      `Unsafe package path: ${relative}`,
    );
    const bytes = await readFile(path.join(directory, ...relative.split('/')));
    chunks.push(...fileEntry(`package/${relative}`, bytes, epochSeconds));
  }
  chunks.push(Buffer.alloc(blockSize * 2));
  // Node writes a deterministic gzip header (mtime=0, OS=3) for the same bytes.
  const packed = gzipSync(Buffer.concat(chunks), { level: 9 });
  packed.writeUInt32LE(0, 4);
  packed[9] = 3;
  await writeFile(destination, packed);
  return packed;
}
