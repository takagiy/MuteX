// Builds the Chrome Web Store screenshots (1280x800).
// 1. Captures the real popup and options page in headless Chrome, with chrome.* stubbed to show sample words.
// 2. Lays out store/slides.md with Marp (marp-core) and screenshots each slide in the same browser.
//    (Marp CLI's own image export talks to Chrome over a pipe, which hangs under Bun on Windows.)
// Run: bun run store:screenshots   (set CHROME_PATH if Chrome isn't found automatically)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Marp } from '@marp-team/marp-core';

const root = path.join(import.meta.dir, '..');
const cache = path.join(import.meta.dir, '.cache');
const outDir = path.join(import.meta.dir, 'screenshots');
const OUTPUTS = ['1-popup.png', '2-options.png']; // one per slide, in order

// Made-up words for the screenshots.
const SAMPLE_STATE = {
  enabled: true,
  applyToFollowing: false,
  lastSync: Date.UTC(2026, 9, 3, 9, 41),
  imported: [
    ['spoiler', true], ['giveaway'], ['crypto'], ['NFT'], ['airdrop'], ['#ad'],
    ['promo code'], ['leak', true], ['rumor'], ['ネタバレ', true], ['follow back'], ['finale', true],
  ].map(([keyword, excludeFollowing = false]) => ({ keyword, excludeFollowing, validUntil: null })),
  local: ['/season \\d+ finale/', 'betting'].map((keyword) => ({ keyword, excludeFollowing: false })),
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

// The slides rendered to one HTML page; served from store/ so relative image paths in slides.md resolve.
const SLIDES_URL = '/store/__slides.html';
function slidesHtml() {
  const marp = new Marp({ html: true });
  marp.themeSet.add(fs.readFileSync(path.join(import.meta.dir, 'theme.css'), 'utf8'));
  const { html, css } = marp.render(fs.readFileSync(path.join(import.meta.dir, 'slides.md'), 'utf8'));
  return `<!doctype html><meta charset="utf-8"><style>${css}
    body { margin: 0; } svg[data-marpit-svg] { display: block; width: 1280px; height: 800px; }</style>${html}`;
}

// Serves the repository so the extension pages load their CSS/JS/icons as usual.
function serveRepo() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const pathname = decodeURIComponent(new URL(req.url).pathname);
      if (pathname === SLIDES_URL) return new Response(slidesHtml(), { headers: { 'content-type': 'text/html' } });
      const file = path.join(root, pathname);
      if (!file.startsWith(root) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
      return new Response(Bun.file(file));
    },
  });
}

// Runs in the page before its own scripts: the extension pages only need these chrome.* calls.
function stubChrome(state) {
  window.chrome = {
    storage: { local: { get: async () => ({ state }), set: async () => {} }, onChanged: { addListener() {} } },
    tabs: { create() {} },
    runtime: { openOptionsPage() {} },
  };
}

async function capture(browser, base, { page: pagePath, width, file, clip }) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.emulateTimezone('UTC');
  await page.setViewport({ width, height: 1200, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(stubChrome, SAMPLE_STATE);
  await page.goto(base + pagePath, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('syncStatus')?.textContent.includes('synced'));
  await page.screenshot({ path: path.join(cache, file), clip: await page.evaluate(clip) });
  await page.close();
}

fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const server = serveRepo();
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ['--lang=en-US'] });
try {
  const base = `http://localhost:${server.port}/`;
  await capture(browser, base, {
    page: 'pages/popup.html',
    width: 320,
    file: 'popup.png',
    clip: () => ({ x: 0, y: 0, width: 320, height: document.body.getBoundingClientRect().height }),
  });
  await capture(browser, base, {
    page: 'pages/options.html',
    width: 460,
    file: 'options.png',
    clip: () => ({ x: 0, y: 0, width: 460, height: document.querySelector('main').getBoundingClientRect().bottom }),
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(base + SLIDES_URL.slice(1), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const slides = await page.$$('svg[data-marpit-svg]');
  if (slides.length !== OUTPUTS.length) throw new Error(`expected ${OUTPUTS.length} slides, got ${slides.length}`);
  for (const [i, slide] of slides.entries()) await slide.screenshot({ path: path.join(outDir, OUTPUTS[i]) });
} finally {
  await browser.close();
  server.stop(true);
}

console.log('wrote', OUTPUTS.map((n) => path.join('store/screenshots', n)).join(', '));
