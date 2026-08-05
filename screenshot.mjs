// Screenshot a localhost URL with Playwright (Chromium is pre-installed in this environment).
// Usage: node screenshot.mjs http://localhost:3000 [label] [--mobile]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label] [--mobile]');
  process.exit(1);
}
const mobile = process.argv.includes('--mobile');
const label = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;

const dir = path.join(process.cwd(), 'temporary screenshots');
fs.mkdirSync(dir, { recursive: true });

let n = 1;
while (fs.existsSync(path.join(dir, `screenshot-${n}${label ? '-' + label : ''}.png`))) n++;
const outPath = path.join(dir, `screenshot-${n}${label ? '-' + label : ''}.png`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(outPath);
