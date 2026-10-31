import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Simple CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generatePng(width: number, height: number, isMaskable: boolean = false): Buffer {
  // Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth 8
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw image data with scanlines (filter byte 0 at start of each scanline)
  const rawBytes = Buffer.alloc((1 + width * 4) * height);
  let pos = 0;

  const cx = width / 2;
  const cy = height / 2;
  const rBg = width * 0.45; // background circle radius for non-maskable

  for (let y = 0; y < height; y++) {
    rawBytes[pos++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r = 5, g = 150, b = 105, a = 255; // #059669 Emerald Green

      if (!isMaskable) {
        // Rounded app badge look for standard icons
        const cornerRadius = width * 0.22;
        const inBadge =
          (x >= cornerRadius && x <= width - cornerRadius) ||
          (y >= cornerRadius && y <= height - cornerRadius) ||
          (Math.sqrt(Math.pow(Math.abs(x - cx) - (cx - cornerRadius), 2) + Math.pow(Math.abs(y - cy) - (cy - cornerRadius), 2)) <= cornerRadius);

        if (!inBadge) {
          a = 0;
        }
      }

      if (a > 0) {
        // Draw grocery bag / basket graphic
        const bagScale = isMaskable ? 0.35 : 0.42;
        const bagWidth = width * bagScale;
        const bagHeight = height * bagScale;
        const bagTop = cy - bagHeight * 0.45;
        const bagBottom = cy + bagHeight * 0.6;
        const bagLeft = cx - bagWidth * 0.5;
        const bagRight = cx + bagWidth * 0.5;

        // Bag body (white rectangle with rounded bottom)
        if (x >= bagLeft && x <= bagRight && y >= bagTop && y <= bagBottom) {
          r = 255; g = 255; b = 255; // White bag body
        }

        // Bag handles (semicircle loop)
        const handleR = bagWidth * 0.28;
        const handleThickness = width * 0.035;
        const handleCy = bagTop;
        const handleDist = Math.sqrt(dx * dx + (y - handleCy) * (y - handleCy));
        if (y < handleCy && handleDist >= (handleR - handleThickness) && handleDist <= (handleR + handleThickness)) {
          r = 255; g = 255; b = 255; // White handle
        }

        // Gold star/leaf badge in center of bag
        const badgeR = width * 0.08;
        const badgeDist = Math.sqrt(dx * dx + (y - (cy + bagHeight * 0.1)) * (y - (cy + bagHeight * 0.1)));
        if (badgeDist <= badgeR) {
          r = 251; g = 191; b = 36; // Amber-400 #FBBF24
        }
      }

      rawBytes[pos++] = r;
      rawBytes[pos++] = g;
      rawBytes[pos++] = b;
      rawBytes[pos++] = a;
    }
  }

  // Compress IDAT
  const compressed = zlib.deflateSync(rawBytes);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Generate PWA icons
console.log('Generating 192x192 PNG icon...');
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), generatePng(192, 192, false));

console.log('Generating 512x512 PNG icon...');
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), generatePng(512, 512, false));

console.log('Generating 512x512 Maskable PNG icon...');
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), generatePng(512, 512, true));

console.log('Generating 180x180 Apple Touch Icon...');
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), generatePng(180, 180, false));

// Also generate SVG icon for browser tabs
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="128" fill="#059669"/>
  <!-- Bag Handle -->
  <path d="M 196 200 A 60 60 0 0 1 316 200" fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round"/>
  <!-- Bag Body -->
  <path d="M 160 200 L 352 200 L 336 380 A 16 16 0 0 1 320 396 L 192 396 A 16 16 0 0 1 176 380 Z" fill="#FFFFFF"/>
  <!-- Badge -->
  <circle cx="256" cy="298" r="42" fill="#FBBF24"/>
  <!-- Text initials FMP -->
  <text x="256" y="306" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="900" fill="#059669" text-anchor="middle" dominant-baseline="middle">FMP</text>
</svg>`;
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), generatePng(32, 32, false));

console.log('All icons generated successfully in /public!');
