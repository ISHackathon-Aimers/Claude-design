import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

// Rasterize the existing target icon for iOS home screens and notifications.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, crc]);
}
for (const size of [192, 512]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = (x + 0.5) * 512 / size, sy = (y + 0.5) * 512 / size;
    const distance = Math.hypot(sx - 256, sy - 256);
    const white = Math.abs(distance - 150) <= 18 || Math.abs(distance - 70) <= 18 || distance <= 18;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(white ? [255, 255, 255, 255] : [225, 29, 72, 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(new URL(`../public/icon-${size}.png`, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
