import { copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const bundle = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    target: 'esnext',
    minify: false,
    lib: { entry: fileURLToPath(new URL('../pages/_worker.js', import.meta.url)), formats: ['es'] },
  },
});
const { output } = Array.isArray(bundle) ? bundle[0] : bundle;
const worker = output.find((file) => file.type === 'chunk' && file.isEntry);
await writeFile(new URL('../dist-pages/_worker.js', import.meta.url), worker.code);
await copyFile(new URL('../pages/_routes.json', import.meta.url), new URL('../dist-pages/_routes.json', import.meta.url));
