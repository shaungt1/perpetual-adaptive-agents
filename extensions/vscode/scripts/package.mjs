// Builds the .vsix (a zip file) with only an explicit allowlist of files.
// Usage: node package.mjs [outputDirectory]   (default: extensions/vscode/.build)
// Pure Node, so it runs the same in Git Bash on Windows, macOS and Linux.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const outDir = path.resolve(process.argv[2] || path.join(source, '.build'));
fs.mkdirSync(outDir, { recursive: true });
const output = path.join(outDir, `${meta.publisher}.${meta.name}-${meta.version}.vsix`);

// Allowlist: nothing else (plans, tests, logs) can enter the package.
const entries = [
  ['[Content_Types].xml', path.join(source, 'packaging', '[Content_Types].xml')],
  ['extension.vsixmanifest', path.join(source, 'packaging', 'extension.vsixmanifest')],
  ...['package.json', 'extension.js', 'README.md'].map(n => [`extension/${n}`, path.join(source, n)]),
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const parts = []; const central = []; let offset = 0;
for (const [name, file] of entries) {
  const data = fs.readFileSync(file);
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  parts.push(local, nameBuf, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(output, Buffer.concat([...parts, cenBuf, end]));
console.log(output);
