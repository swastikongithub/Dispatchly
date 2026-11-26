// Generates the web theme from ../design-tokens.json, the single source of truth (PLAN.md §4.1):
//   src/styles/tokens.css  Tailwind v4 `@theme`, with the default palette and scales removed
//   src/app/tokens.ts      the same tokens for TypeScript (map styles, markers, motion)
//
//   node scripts/build-tokens.mjs           write both files
//   node scripts/build-tokens.mjs --check   fail if either file is out of date (CI)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(web, '../design-tokens.json');
const cssOut = resolve(web, 'src/styles/tokens.css');
const tsOut = resolve(web, 'src/app/tokens.ts');
const check = process.argv.includes('--check');

const tokens = JSON.parse(readFileSync(source, 'utf8'));

// The self-hosted variable fonts (@fontsource-variable) register their families as
// 'Inter Variable' and 'Inter Tight Variable'. Put each one in front of the family the token
// names, so the token's stack (and its fallbacks) stays exactly as approved.
const selfHosted = { 'Inter Tight': 'Inter Tight Variable', Inter: 'Inter Variable' };

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const px = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?px$/.test(v);

function fontStack(stack) {
  return stack
    .split(',')
    .map((f) => f.trim())
    .flatMap((f) => {
      const name = f.replace(/^'|'$/g, '');
      return selfHosted[name] ? [`'${selfHosted[name]}'`, f] : [f];
    })
    .join(', ');
}

// Every leaf under `node`, as [path segments, value]. Keys starting with `$` are notes.
function* leaves(node, path = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (isPlain(value)) yield* leaves(value, [...path, key]);
    else yield [[...path, key], value];
  }
}

const name = (path) => path.map(kebab).join('-');
const lines = [];
const section = (title) => lines.push('', `  /* ${title} */`);
const v = (prop, value) => lines.push(`  --${prop}: ${value};`);

// Colours: every colour token, including the map and marker palettes.
section('Colour (design-tokens.json → color)');
for (const [path, value] of leaves(tokens.color)) v(`color-${name(path)}`, value);

// Fonts and weights.
section('Type (→ font, type)');
v('font-display', fontStack(tokens.font.display));
v('font-text', fontStack(tokens.font.text));
const weightNames = { 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold' };
const weights = [...new Set([...tokens.font.weights.text, ...tokens.font.weights.display])].sort(
  (a, b) => a - b,
);
for (const w of weights) v(`font-weight-${weightNames[w]}`, w);

// Type styles become Tailwind `text-*` sizes (with their line height, tracking and weight)
// and a `type-*` utility that also sets the family. Styles without a single CSS size
// (the 17–19px wordmark, the zoom-dependent map label) are only exported to TypeScript.
const typeUtilities = [];
for (const [key, style] of Object.entries(tokens.type)) {
  if (!style.size || !/^(clamp\(.*\)|\d+px)$/.test(style.size)) continue;
  const n = kebab(key);
  v(`text-${n}`, style.size);
  if (style.lineHeight !== undefined) v(`text-${n}--line-height`, style.lineHeight);
  if (style.tracking !== undefined) v(`text-${n}--letter-spacing`, style.tracking);
  if (style.weight !== undefined) v(`text-${n}--font-weight`, style.weight);
  const decls = [
    `font-family: var(--font-${style.family});`,
    `font-size: var(--text-${n});`,
    style.lineHeight !== undefined && `line-height: var(--text-${n}--line-height);`,
    style.tracking !== undefined && `letter-spacing: var(--text-${n}--letter-spacing);`,
    style.weight !== undefined && `font-weight: var(--text-${n}--font-weight);`,
  ].filter(Boolean);
  typeUtilities.push(`@utility type-${n} {\n  ${decls.join('\n  ')}\n}`);
}

section('Radius (→ radius)');
for (const [key, value] of Object.entries(tokens.radius)) v(`radius-${kebab(key)}`, value);

// Spacing: the space scale by its pixel value (p-12 is 12px, and only scale values exist),
// then component sizes and single-pixel layout dimensions by name (size-avatar, w-orders-panel-width).
section('Spacing (→ space, size, layout)');
for (const n of tokens.space) v(`spacing-${n}`, `${n}px`);
for (const [path, value] of leaves(tokens.size)) v(`spacing-${name(path)}`, value);
for (const [path, value] of leaves(tokens.layout)) {
  if (path[0] === 'breakpoints' || !px(value)) continue;
  v(`spacing-${name(path)}`, value);
}

// Breakpoints: `min` and `max` are the supported width range (360–1920), not breakpoints.
section('Breakpoints (→ layout.breakpoints)');
for (const [key, value] of Object.entries(tokens.layout.breakpoints)) {
  if (key !== 'min' && key !== 'max') v(`breakpoint-${kebab(key)}`, value);
}

section('Shadow (→ shadow)');
for (const [key, value] of Object.entries(tokens.shadow)) v(`shadow-${kebab(key)}`, value);

section('Motion (→ motion)');
for (const [key, value] of Object.entries(tokens.motion.easing)) v(`ease-${kebab(key)}`, value);
for (const [key, value] of Object.entries(tokens.motion.duration))
  v(`duration-${kebab(key)}`, value);
for (const [key, value] of Object.entries(tokens.motion.scale)) v(`scale-${kebab(key)}`, value);

section('Borders, opacity and focus (→ borderWidth, opacity, focus)');
for (const [key, value] of Object.entries(tokens.borderWidth))
  v(`border-width-${kebab(key)}`, value);
for (const [key, value] of Object.entries(tokens.opacity)) v(`opacity-${kebab(key)}`, value);
v('focus-width', tokens.focus.width);
v('focus-offset', tokens.focus.offset);
v('focus-color', `var(--color-${name(tokens.focus.color.split('.'))})`);

section('Icons and brand (→ icon, brand)');
v('icon-stroke', tokens.icon.stroke);
v('icon-stroke-emphasis', tokens.icon.strokeEmphasis);
v('icon-stroke-heavy', tokens.icon.strokeHeavy);
for (const s of tokens.icon.sizes) v(`icon-size-${s}`, `${s}px`);
for (const group of ['markSize', 'gap', 'wordmarkSize']) {
  for (const [key, value] of Object.entries(tokens.brand[group])) {
    v(`brand-${kebab(group)}-${kebab(key)}`, value);
  }
}

const banner = '/* Generated from design-tokens.json by scripts/build-tokens.mjs. Do not edit. */';
const css = [
  banner,
  '',
  '/* `static` keeps every variable in the output, so component styles can use them all. */',
  '@theme static {',
  '  /* No default Tailwind palette, scales or fonts: only the approved tokens exist. */',
  '  --*: initial;',
  ...lines,
  '}',
  '',
  ...typeUtilities.flatMap((u) => [u, '']),
].join('\n');

// TypeScript: the whole token tree without the `$` notes and metadata, typed `as const`.
function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (!isPlain(node)) return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => !k.startsWith('$') && k !== 'approved')
      .map(([k, val]) => [k, strip(val)]),
  );
}
const ts = [
  banner,
  '',
  `export const tokens = ${JSON.stringify(strip(tokens), null, 2)} as const;`,
  '',
  'export type Tokens = typeof tokens;',
  '',
].join('\n');

const outputs = [
  [cssOut, css],
  [tsOut, ts],
];
let stale = 0;
for (const [file, raw] of outputs) {
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(raw, { ...options, filepath: file });
  const rel = relative(web, file);
  if (check) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (current !== formatted) {
      stale++;
      console.error(`${rel} is out of date. Run: npm run tokens`);
    }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, formatted);
    console.log(`wrote ${rel}`);
  }
}
if (stale) process.exit(1);
