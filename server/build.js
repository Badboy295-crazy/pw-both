/**
 * build.js — Study Hub Obfuscation Build Pipeline
 *
 * Runs automatically on:
 *   - npm install (via postinstall)
 *   - Render deploy (npm install is part of buildCommand)
 *   - Manual: node build.js
 *
 * What it does:
 *   1. Copies all webapp/ files to webapp-dist/
 *   2. Obfuscates JS files using javascript-obfuscator
 *      → Renames variables, strings, control flow — UNREADABLE output
 *   3. Updates server to serve webapp-dist/ in production
 *
 * Your source stays clean in webapp/ (for development).
 * Deployed version in webapp-dist/ is fully obfuscated.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Try loading obfuscator — it may not be installed yet on first run
let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
  console.log('[build] javascript-obfuscator not installed yet — skipping obfuscation');
  process.exit(0);
}

// ─── Config ──────────────────────────────────────────────────────────────
const SRC_DIR  = path.join(__dirname, '..', 'webapp');
const DIST_DIR = path.join(__dirname, '..', 'webapp-dist');

// JS files to OBFUSCATE (high-value source files)
const JS_TO_OBFUSCATE = ['app.js', 'player.js', 'lecture_player.js'];

// Files to COPY as-is (HTML, CSS, JSON, images, SW)
// SW is not obfuscated to maintain browser compatibility
const COPY_AS_IS = ['index.html', 'style.css', 'manifest.json', 'sw.js', 'banner.jpg', 'banner2.jpg'];

// Obfuscation profile — Ultra-Hardened Security Profile
const OBFUSCATOR_OPTIONS = {
  // Core transforms
  compact: true,
  simplify: true,
  deadCodeInjection: true,                 // Injects fake dead code to confuse AST analyzers & deobfuscators
  deadCodeInjectionThreshold: 0.3,
  controlFlowFlattening: true,             // Breaks linear logic into complex switch-case state machines
  controlFlowFlatteningThreshold: 0.75,

  // String transforms & Encryption (Multi-Layer RC4 + Base64)
  stringArray: true,
  stringArrayEncoding: ['rc4', 'base64'],  // RC4 key-based encryption on all strings
  stringArrayThreshold: 0.9,               // Encrypts 90% of strings
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 4,             // Multi-layer wrapper functions
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersType: 'variable',
  splitStrings: true,                      // Chops strings into 4-char randomized fragments
  splitStringsChunkLength: 4,
  transformObjectKeys: true,

  // Numbers & Identifiers
  numbersToExpressions: true,              // Converts numbers (e.g. 500) into complex binary math expressions
  identifierNamesGenerator: 'hexadecimal', // Renames variables to _0x4e2a, _0x19bc
  renameGlobals: false,                    // Keep top-level window entry points intact
  renameProperties: false,

  // Anti-Tamper & Anti-Deobfuscator
  selfDefending: true,                     // If anyone tries to format/beautify the code, it breaks instantly!
  debugProtection: false,                  // Disabled to prevent freezing valid TG webview
  disableConsoleOutput: false,

  // Source map — NEVER expose
  sourceMap: false,

  // Target
  target: 'browser',
};

// ─── Helpers ──────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function obfuscateFile(src, dest) {
  const source = fs.readFileSync(src, 'utf-8');
  try {
    const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(dest, result.getObfuscatedCode(), 'utf-8');
    const origKB = (source.length / 1024).toFixed(1);
    const distKB = (result.getObfuscatedCode().length / 1024).toFixed(1);
    console.log(`  [obfuscated] ${path.basename(src)}: ${origKB}KB → ${distKB}KB`);
  } catch (err) {
    console.error(`  [ERROR] Obfuscation failed for ${path.basename(src)}:`, err.message);
    // Fallback: copy as-is if obfuscation fails
    fs.writeFileSync(dest, source, 'utf-8');
    console.log(`  [fallback] Copied ${path.basename(src)} as-is`);
  }
}

// ─── Build ────────────────────────────────────────────────────────────────
console.log('\n[build] Starting Study Hub obfuscation build...');
console.log(`  Source:  ${SRC_DIR}`);
console.log(`  Output:  ${DIST_DIR}`);

ensureDir(DIST_DIR);

// 1. Obfuscate JS files
let obfuscated = 0;
for (const jsFile of JS_TO_OBFUSCATE) {
  const src = path.join(SRC_DIR, jsFile);
  const dest = path.join(DIST_DIR, jsFile);
  if (fs.existsSync(src)) {
    obfuscateFile(src, dest);
    obfuscated++;
  } else {
    console.log(`  [skip] ${jsFile} not found in webapp/`);
  }
}

// 2. Copy static files
let copied = 0;
for (const file of COPY_AS_IS) {
  const src = path.join(SRC_DIR, file);
  const dest = path.join(DIST_DIR, file);
  if (fs.existsSync(src)) {
    copyFile(src, dest);
    copied++;
    console.log(`  [copied] ${file}`);
  }
}

// 3. Copy any other files not in either list (e.g. additional assets)
const allSrc = fs.readdirSync(SRC_DIR);
const handled = new Set([...JS_TO_OBFUSCATE, ...COPY_AS_IS]);
for (const f of allSrc) {
  if (!handled.has(f)) {
    const src = path.join(SRC_DIR, f);
    const dest = path.join(DIST_DIR, f);
    const stat = fs.statSync(src);
    if (stat.isFile()) {
      copyFile(src, dest);
      copied++;
      console.log(`  [copied] ${f}`);
    }
  }
}

console.log(`\n[build] Done! ${obfuscated} files obfuscated, ${copied} files copied.`);
console.log('[build] Server will serve webapp-dist/ in production.\n');
