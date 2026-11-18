import { IncomingMessage } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { handleShared, isSharedPath } from '../pages/shared.js';

export function sqliteBinding(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(readFileSync(new URL('../pages/schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => {
    const statement = db.prepare(sql);
    const bind = (...params) => ({ execute: () => ({ results: statement.all(...params) }) });
    return { ...bind(), bind };
  };
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}

const defaultDatabase = fileURLToPath(new URL('../.local-data/shared.sqlite', import.meta.url));

export function localShared() {
  let db;
  return (incoming, outgoing, next) => {
    if (!(incoming instanceof IncomingMessage) || !isSharedPath(incoming.url?.split('?')[0] || '')) return next();
    const host = incoming.headers.host || '';
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return outgoing.writeHead(403).end();
    void (async () => {
      try {
        db ||= sqliteBinding(process.env.DUTY_LOCAL_DB ? resolve(process.env.DUTY_LOCAL_DB) : defaultDatabase);
        const init = { method: incoming.method, headers: incoming.headers };
        if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
          init.body = Readable.toWeb(incoming);
          init.duplex = 'half';
        }
        const request = new Request('http://' + host + incoming.url, init);
        const response = await handleShared(request, db);
        outgoing.writeHead(response.status, { 'Cache-Control': 'private, no-store', ...Object.fromEntries(response.headers) });
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(503, { 'Cache-Control': 'private, no-store' }).end();
      }
    })();
  };
}
