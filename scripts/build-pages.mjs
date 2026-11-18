import { copyFile } from 'node:fs/promises';

await Promise.all(['_worker.js', '_routes.json'].map((file) => copyFile(
  new URL(`../pages/${file}`, import.meta.url),
  new URL(`../dist-pages/${file}`, import.meta.url),
)));
