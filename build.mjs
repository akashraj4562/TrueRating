/**
 * ClearCart build script — esbuild
 *
 * Produces an unpacked MV3 extension in dist/.
 * Run: node build.mjs
 * Run watch: node build.mjs --watch
 */

import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, copyFileSync, existsSync } from 'fs';

const watch = process.argv.includes('--watch');

// Ensure output directories exist
mkdirSync('dist', { recursive: true });
mkdirSync('dist/icons', { recursive: true });

const sharedConfig = {
  bundle: true,
  platform: 'browser',
  // why: target Chrome 120+ — MV3 requires modern Chrome; targeting 120 gives us
  // modern JS without polyfills while covering the vast majority of active installs.
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};

// ── Entry points ────────────────────────────────────────────────────────────

const entryPoints = [
  {
    in: 'src/content/amazon.ts',
    out: 'dist/content-amazon',
    // why: IIFE so the content script is self-contained and doesn't pollute
    // the page's global scope. No ES module exports needed here.
    format: 'iife',
  },
  {
    in: 'src/popup/popup.ts',
    out: 'dist/popup',
    // why: IIFE for the popup too — keeps the bundle simple and consistent.
    format: 'iife',
  },
];

if (watch) {
  const contexts = await Promise.all(
    entryPoints.map(({ in: entry, out, format }) =>
      esbuild.context({ ...sharedConfig, entryPoints: [entry], outfile: `${out}.js`, format }),
    ),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching for changes…');
} else {
  await Promise.all(
    entryPoints.map(({ in: entry, out, format }) =>
      esbuild.build({ ...sharedConfig, entryPoints: [entry], outfile: `${out}.js`, format }),
    ),
  );
}

// ── Static assets ────────────────────────────────────────────────────────────

copyFileSync('manifest.json', 'dist/manifest.json');
copyFileSync('src/popup/popup.html', 'dist/popup.html');

// Copy icons if they exist (placeholder until real icons are added)
if (existsSync('src/icons')) {
  cpSync('src/icons', 'dist/icons', { recursive: true });
}

console.log('✓ Build complete → dist/');
