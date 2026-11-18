import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseScheduleFile } from '../src/domain/readers.js';

const filenames = process.argv.slice(2);
if (!filenames.length) throw new Error('用法：node scripts/verify-roster.mjs <值班表> [其他值班表]');
const { window } = new JSDOM();
try {
  for (const filename of filenames) {
    try {
      const file = new File([await readFile(filename)], basename(filename));
      const { sessions, warnings } = await parseScheduleFile(file, { DOM: window.DOMParser });
      console.log(JSON.stringify({ file: file.name, sessions: sessions.length, warnings }));
      if (warnings.length) process.exitCode = 1;
    } catch (error) {
      console.error(`${basename(filename)}：${error.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  window.close();
}
