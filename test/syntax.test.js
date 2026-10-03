// Every script the extension loads must at least parse; a syntax error in one silently kills that part.
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dir, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const pages = [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean);
const pageScripts = pages.flatMap((page) => {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => path.posix.join(path.posix.dirname(page), m[1]));
});
const scripts = [...new Set([...manifest.content_scripts.flatMap((c) => c.js || []), ...pageScripts])];

test('found scripts to check', () => {
  expect(scripts).toEqual(expect.arrayContaining(['pages/common.js', 'pages/popup.js', 'pages/options.js']));
});

for (const f of scripts) {
  test(`parses: ${f}`, () => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    expect(() => new Function(src)).not.toThrow();
  });
}
