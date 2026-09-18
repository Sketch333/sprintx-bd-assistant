const { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const extensionDist = resolve(root, 'extension', 'dist');
const publicDir = resolve(root, 'public');
const builtIndex = resolve(extensionDist, 'index.html');
const builtAssets = resolve(extensionDist, 'assets');

if (!existsSync(builtIndex) || !existsSync(builtAssets)) {
  throw new Error('Extension build output is missing. Run the extension build before syncing web assets.');
}

mkdirSync(publicDir, { recursive: true });

const publicAssets = resolve(publicDir, 'assets');
rmSync(publicAssets, { recursive: true, force: true });
cpSync(builtAssets, publicAssets, { recursive: true });

copyFileSync(builtIndex, resolve(publicDir, 'index.html'));

const favicon = resolve(extensionDist, 'favicon.svg');
if (existsSync(favicon)) copyFileSync(favicon, resolve(publicDir, 'favicon.svg'));

console.log('Synced latest extension UI to public/ for Vercel.');
