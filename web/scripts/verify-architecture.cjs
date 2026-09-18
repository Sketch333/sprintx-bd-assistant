const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const webRoot = resolve(__dirname, '..');
const repoRoot = resolve(webRoot, '..');

function requireFile(path) {
  if (!existsSync(path)) throw new Error(`Missing required web-preview file: ${path}`);
}

requireFile(resolve(repoRoot, 'extension', 'src', 'App.tsx'));
requireFile(resolve(repoRoot, 'extension', 'src', 'styles.css'));
requireFile(resolve(webRoot, 'src', 'main.tsx'));

const entry = readFileSync(resolve(webRoot, 'src', 'main.tsx'), 'utf8');
if (!entry.includes("../../extension/src/App") || !entry.includes("../../extension/src/styles.css")) {
  throw new Error('The web preview must reuse the Workspace 2.0 App and styles from extension/src.');
}

const vercel = JSON.parse(readFileSync(resolve(repoRoot, 'vercel.json'), 'utf8'));
const builds = vercel.builds ?? [];
const staticBuild = builds.find((build) => build.src === 'package.json' && build.use === '@vercel/static-build');
const apiBuild = builds.find((build) => build.src === 'api/index.ts' && build.use === '@vercel/node');
if (!staticBuild || staticBuild.config?.distDir !== 'web/dist' || !apiBuild) {
  throw new Error('Vercel must publish web/dist from the root static builder and build api/index.ts separately.');
}
if ('outputDirectory' in vercel || 'buildCommand' in vercel) {
  throw new Error('Do not collapse the web preview back into a root outputDirectory/buildCommand deployment.');
}

const routes = vercel.routes ?? [];
if (!routes.some((route) => route.src === '/api/(.*)' && route.dest === '/api/index.ts')) {
  throw new Error('Vercel API routing is missing.');
}
if (!routes.some((route) => route.src === '/' && route.dest === '/index.html')) {
  throw new Error('The web preview must own the canonical root route.');
}

console.log('Verified dedicated web-preview architecture.');
