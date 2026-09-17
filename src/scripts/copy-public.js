const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../../extension/dist');
const dest = path.resolve(__dirname, '../../public');

if (fs.existsSync(src)) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('[build] Copied extension/dist to public/ for static hosting');
} else {
  console.warn('[build] Warning: extension/dist does not exist yet');
}
