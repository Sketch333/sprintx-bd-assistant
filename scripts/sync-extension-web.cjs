const { cpSync, existsSync, mkdirSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const extensionDist = resolve(root, 'extension', 'dist');
const publicDir = resolve(root, 'public');

for (const required of ['index.html', 'assets']) {
  const target = resolve(extensionDist, required);
  if (!existsSync(target)) throw new Error(`Missing extension build output: ${target}`);
}

mkdirSync(publicDir, { recursive: true });

mkdirSync(resolve(publicDir, 'assets'), { recursive: true });
cpSync(resolve(extensionDist, 'assets'), resolve(publicDir, 'assets'), { recursive: true, force: true });
copyFileSync(resolve(extensionDist, 'index.html'), resolve(publicDir, 'index.html'));

for (const asset of ['favicon.svg']) {
  const src = resolve(extensionDist, asset);
  if (existsSync(src)) copyFileSync(src, resolve(publicDir, asset));
}

console.log('Synced Workspace 2.0 web bundle into public/.');
