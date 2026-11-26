// Builds every app icon from the Dispatchly mark (ring + orange dot, as drawn in
// designs/html/*.html), with colours read from design-tokens.json.
//
//   npm run icons
//
// Writes to public/: favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png,
// icon-192.png, icon-512.png, icon-maskable-512.png and manifest.webmanifest.
// The output is committed; re-run this only when the mark or the tokens change.

import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const tokens = JSON.parse(await readFile(new URL('../design-tokens.json', root), 'utf8'));
const { color } = tokens;

const C = {
  tileTop: color.dark.raisedStrong,
  tileBottom: color.ink,
  border: color.dark.panelBorder,
  bevel: color.dark.hairline,
  ringTop: color.dark.textPrimaryLanding,
  ringBottom: color.dark.textBody,
  dotLight: color.accent.orangeTextOnDark,
  dot: color.accent.orange,
  dotShade: color.accent.orangeOnLight,
};

// Same geometry as the wordmark mark in the designs (24-unit grid).
const MARK = { ring: { cx: 12, cy: 12, r: 8.5, w: 2 }, dot: { cx: 18, cy: 6, r: 3.4, w: 1.6 } };
// Visual bounds of ring + dot (incl. strokes), used to centre the mark optically.
const BOUNDS = { x0: 2.5, y0: 1.8, x1: 22.2, y1: 21.5 };

/** Smoothed-corner rectangle (Figma corner smoothing 0.6, the iOS app-icon curve). */
function squircle(size, radius, smoothing = 0.6) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const p = (1 + smoothing) * radius;
  const arcMeasure = 90 * (1 - smoothing);
  const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p34 = radius * Math.tan(rad(alpha / 2));
  const beta = 45 * smoothing;
  const c = p34 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  const n = (v) => +v.toFixed(2);
  const [A, AB, ABC, Cc, D, BC, L, R, S, P] = [
    a,
    a + b,
    a + b + c,
    c,
    d,
    b + c,
    arc,
    radius,
    size,
    p,
  ].map(n);
  return [
    `M${n(S - P)} 0c${A} 0 ${AB} 0 ${ABC} ${D}a${R} ${R} 0 0 1 ${L} ${L}c${D} ${Cc} ${D} ${BC} ${D} ${ABC}`,
    `L${S} ${n(S - P)}c0 ${A} 0 ${AB} ${-D} ${ABC}a${R} ${R} 0 0 1 ${-L} ${L}c${-Cc} ${D} ${-BC} ${D} ${-ABC} ${D}`,
    `L${P} ${S}c${-A} 0 ${-AB} 0 ${-ABC} ${-D}a${R} ${R} 0 0 1 ${-L} ${-L}c${-D} ${-Cc} ${-D} ${-BC} ${-D} ${-ABC}`,
    `L0 ${P}c0 ${-A} 0 ${-AB} ${D} ${-ABC}a${R} ${R} 0 0 1 ${L} ${-L}c${Cc} ${-D} ${BC} ${-D} ${ABC} ${-D}Z`,
  ].join('');
}

/**
 * The icon on a 512 canvas.
 * shape 'squircle': rounded tile with transparent corners (favicon, manifest "any").
 * shape 'square': full-bleed tile for platforms that apply their own mask (iOS, maskable).
 * scale: size of one mark unit in px; 17 fills the tile, 16 keeps a maskable icon in its safe zone.
 */
function iconSvg({ shape, scale }) {
  const S = 512;
  const tile = shape === 'squircle' ? squircle(S, 115) : `M0 0H${S}V${S}H0Z`;
  const tx = +(S / 2 - ((BOUNDS.x0 + BOUNDS.x1) / 2) * scale).toFixed(2);
  const ty = +(S / 2 - ((BOUNDS.y0 + BOUNDS.y1) / 2) * scale).toFixed(2);
  // The dot's knockout stroke uses the tile gradient mapped into the mark's own coordinates.
  const ky0 = +(-ty / scale).toFixed(3);
  const ky1 = +((S - ty) / scale).toFixed(3);
  const { ring, dot } = MARK;
  const edge =
    shape === 'squircle'
      ? `
  <use href="#tile-shape" fill="none" stroke="${C.border}" stroke-width="4" clip-path="url(#inside)"/>
  <use href="#tile-shape" fill="none" stroke="url(#bevel)" stroke-width="6" clip-path="url(#inside)"/>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.tileTop}"/>
      <stop offset="1" stop-color="${C.tileBottom}"/>
    </linearGradient>
    <linearGradient id="knockout" gradientUnits="userSpaceOnUse" x1="0" y1="${ky0}" x2="0" y2="${ky1}">
      <stop offset="0" stop-color="${C.tileTop}"/>
      <stop offset="1" stop-color="${C.tileBottom}"/>
    </linearGradient>
    <linearGradient id="bevel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bevel}"/>
      <stop offset="0.5" stop-color="${C.bevel}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.ringTop}"/>
      <stop offset="1" stop-color="${C.ringBottom}"/>
    </linearGradient>
    <radialGradient id="dot" fx="0.34" fy="0.3">
      <stop offset="0" stop-color="${C.dotLight}"/>
      <stop offset="0.55" stop-color="${C.dot}"/>
      <stop offset="1" stop-color="${C.dotShade}"/>
    </radialGradient>
    <path id="tile-shape" d="${tile}"/>
    <clipPath id="inside"><use href="#tile-shape"/></clipPath>
  </defs>
  <use href="#tile-shape" fill="url(#tile)"/>${edge}
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <circle cx="${ring.cx}" cy="${ring.cy}" r="${ring.r}" fill="none" stroke="url(#ring)" stroke-width="${ring.w}"/>
    <circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="url(#dot)" stroke="url(#knockout)" stroke-width="${dot.w}"/>
  </g>
</svg>
`;
}

/** ICO container holding PNG images (supported by every browser that still asks for .ico). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const squircleSvg = iconSvg({ shape: 'squircle', scale: 17 });
const squareSvg = iconSvg({ shape: 'square', scale: 17 });
const maskableSvg = iconSvg({ shape: 'square', scale: 16 });

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<!doctype html><body style="margin:0">${sized}</body>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const out = (name) => new URL(`public/${name}`, root);
await writeFile(out('favicon.svg'), squircleSvg);
const icoImages = [];
for (const size of [16, 32, 48]) icoImages.push({ size, data: await png(squircleSvg, size) });
await writeFile(out('favicon.ico'), ico(icoImages));
await writeFile(out('apple-touch-icon.png'), await png(squareSvg, 180));
await writeFile(out('icon-192.png'), await png(squircleSvg, 192));
await writeFile(out('icon-512.png'), await png(squircleSvg, 512));
await writeFile(out('icon-maskable-512.png'), await png(maskableSvg, 512));
await browser.close();

const manifest = {
  name: 'Dispatchly',
  short_name: 'Dispatchly',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  start_url: '/',
  background_color: color.ink,
  theme_color: color.ink,
};
await writeFile(out('manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

console.log('Icons written to public/');
