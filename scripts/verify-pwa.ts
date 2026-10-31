import fs from 'fs';
import path from 'path';
import http from 'http';
import app from '../server.ts';

function parsePngDimensions(buf: Buffer): { width: number; height: number } {
  // Check PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) {
      throw new Error('Not a valid PNG file signature');
    }
  }
  // IHDR width and height are at offset 16 and 20 (big-endian 32-bit unsigned integers)
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

async function runPWATests() {
  console.log('======================================================');
  console.log('📱 Verifying PWA Compliance & Android Installability');
  console.log('======================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`✅ PASSED: ${msg}`);
      passed++;
    } else {
      console.error(`❌ FAILED: ${msg}`);
      failed++;
    }
  }

  const rootDir = process.cwd();
  const publicDir = path.join(rootDir, 'public');

  // 1. Manifest file existence & JSON syntax
  const manifestPath = path.join(publicDir, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'public/manifest.json exists on disk');

  const manifestWebmanifestPath = path.join(publicDir, 'manifest.webmanifest');
  assert(fs.existsSync(manifestWebmanifestPath), 'public/manifest.webmanifest exists on disk');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // 2. Chrome PWA Installability required manifest properties
  assert(Boolean(manifest.id), `Manifest has valid id: "${manifest.id}"`);
  assert(Boolean(manifest.name && manifest.name.includes('FMP Supermart')), `Manifest name: "${manifest.name}"`);
  assert(Boolean(manifest.short_name && manifest.short_name.length <= 12), `Manifest short_name <= 12 chars: "${manifest.short_name}" (${manifest.short_name.length} chars)`);
  assert(manifest.start_url === '/', `Manifest start_url is "/": "${manifest.start_url}"`);
  assert(manifest.scope === '/', `Manifest scope is "/": "${manifest.scope}"`);
  assert(manifest.display === 'standalone', `Manifest display is "standalone": "${manifest.display}"`);
  assert(manifest.theme_color === '#059669', `Manifest theme_color is "#059669": "${manifest.theme_color}"`);
  assert(manifest.background_color === '#ffffff', `Manifest background_color is "#ffffff": "${manifest.background_color}"`);

  // 3. Icons validation
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Manifest defines icons array with multiple resolutions');

  const icon192 = manifest.icons.find((i: any) => i.sizes === '192x192' && i.type === 'image/png');
  assert(Boolean(icon192), 'Manifest has 192x192 image/png icon');

  const icon512 = manifest.icons.find((i: any) => i.sizes === '512x512' && i.type === 'image/png');
  assert(Boolean(icon512), 'Manifest has 512x512 image/png icon');

  const iconMaskable = manifest.icons.find((i: any) => i.purpose && i.purpose.includes('maskable'));
  assert(Boolean(iconMaskable), 'Manifest has maskable icon for Android adaptive launcher icons');

  // 4. Binary icon verification on disk
  const pwa192Buf = fs.readFileSync(path.join(publicDir, 'pwa-192x192.png'));
  const dim192 = parsePngDimensions(pwa192Buf);
  assert(dim192.width === 192 && dim192.height === 192, `pwa-192x192.png is valid PNG with dimensions ${dim192.width}x${dim192.height}`);

  const pwa512Buf = fs.readFileSync(path.join(publicDir, 'pwa-512x512.png'));
  const dim512 = parsePngDimensions(pwa512Buf);
  assert(dim512.width === 512 && dim512.height === 512, `pwa-512x512.png is valid PNG with dimensions ${dim512.width}x${dim512.height}`);

  const pwaMaskableBuf = fs.readFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'));
  const dimMaskable = parsePngDimensions(pwaMaskableBuf);
  assert(dimMaskable.width === 512 && dimMaskable.height === 512, `pwa-maskable-512x512.png is valid PNG with dimensions ${dimMaskable.width}x${dimMaskable.height}`);

  const appleTouchBuf = fs.readFileSync(path.join(publicDir, 'apple-touch-icon.png'));
  const dimApple = parsePngDimensions(appleTouchBuf);
  assert(dimApple.width === 180 && dimApple.height === 180, `apple-touch-icon.png is valid PNG with dimensions ${dimApple.width}x${dimApple.height}`);

  // 5. Service Worker validation
  const swPath = path.join(publicDir, 'sw.js');
  assert(fs.existsSync(swPath), 'public/sw.js exists on disk');
  const swContent = fs.readFileSync(swPath, 'utf-8');
  assert(swContent.includes('addEventListener(\'install\''), 'Service worker registers "install" event handler');
  assert(swContent.includes('addEventListener(\'activate\''), 'Service worker registers "activate" event handler');
  assert(swContent.includes('addEventListener(\'fetch\''), 'Service worker registers "fetch" event handler (Chrome installability criterion)');

  // 6. index.html head tags
  const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  assert(htmlContent.includes('rel="manifest"'), 'index.html has <link rel="manifest"> tag');
  assert(htmlContent.includes('name="theme-color" content="#059669"'), 'index.html has <meta name="theme-color" content="#059669">');
  assert(htmlContent.includes('rel="apple-touch-icon"'), 'index.html has <link rel="apple-touch-icon">');
  assert(htmlContent.includes('name="viewport"'), 'index.html has <meta name="viewport">');

  // 7. Express HTTP Server routes test
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(3456, resolve));

  async function checkRoute(endpoint: string, expectedType: string): Promise<boolean> {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:3456${endpoint}`, (res) => {
        const ct = res.headers['content-type'] || '';
        const ok = res.statusCode === 200 && ct.toLowerCase().includes(expectedType.toLowerCase());
        resolve(ok);
      }).on('error', () => resolve(false));
    });
  }

  const manifestHttpOk = await checkRoute('/manifest.json', 'json');
  assert(manifestHttpOk, 'GET /manifest.json returns 200 OK with application/manifest+json');

  const webmanifestHttpOk = await checkRoute('/manifest.webmanifest', 'json');
  assert(webmanifestHttpOk, 'GET /manifest.webmanifest returns 200 OK with application/manifest+json');

  const swHttpOk = await checkRoute('/sw.js', 'javascript');
  assert(swHttpOk, 'GET /sw.js returns 200 OK with application/javascript');

  const icon192HttpOk = await checkRoute('/pwa-192x192.png', 'image/png');
  assert(icon192HttpOk, 'GET /pwa-192x192.png returns 200 OK with image/png');

  const icon512HttpOk = await checkRoute('/pwa-512x512.png', 'image/png');
  assert(icon512HttpOk, 'GET /pwa-512x512.png returns 200 OK with image/png');

  server.close();

  console.log('======================================================');
  console.log(`PWA Verification Summary: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPWATests().catch((err) => {
  console.error('PWA Test error:', err);
  process.exit(1);
});
