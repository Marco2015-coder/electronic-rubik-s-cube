/** 把渲染进程的静态资源拷贝到 dist。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'ui');
const to = path.join(root, 'dist', 'ui');

fs.mkdirSync(to, { recursive: true });
fs.copyFileSync(path.join(from, 'index.html'), path.join(to, 'index.html'));

const stylesFrom = path.join(from, 'styles');
const stylesTo = path.join(to, 'styles');
fs.mkdirSync(stylesTo, { recursive: true });
for (const file of fs.readdirSync(stylesFrom)) {
  if (file.endsWith('.css')) fs.copyFileSync(path.join(stylesFrom, file), path.join(stylesTo, file));
}

console.log('静态资源已拷贝到 dist/ui');
