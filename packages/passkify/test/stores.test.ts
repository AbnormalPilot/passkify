/**
 * Shipped store adapters, against the same conformance suite users run.
 *
 * SQLite is exercised for real here, because recent Node ships one — which
 * makes this the test that proves the suite works against an actual database
 * rather than only against an in-memory map. Postgres, Redis and MongoDB need
 * services and run in CI.
 *
 * `node:sqlite` arrived in Node 22.5 and this package supports Node 20, so the
 * module is probed rather than imported: a static import took the whole file
 * down on the Node 20 row of the matrix. Where it is absent the suite skips.
 * Nothing about the adapter goes unverified by that — it takes the driver as
 * an argument, so what is missing is this Node's database, not its coverage.
 */

import { test } from 'vitest';

import { runStoreConformance } from '#internal/conformance/index.js';
import { sqliteStore } from '#internal/stores/sqlite.js';

type SqliteModule = typeof import('node:sqlite');
let DatabaseSync: SqliteModule['DatabaseSync'] | undefined;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = undefined;
}

if (!DatabaseSync) {
  test.skip('sqlite store conformance — node:sqlite needs Node 22.5 or newer', () => {});
} else {
  runStoreConformance({
    test,
    createStore: async () => {
      const db = new DatabaseSync(':memory:');
      const store = sqliteStore(db as never);
      store.migrate();
      return { store, cleanup: async () => db.close() };
    },
    // SQLite stores timestamps as ISO strings, so they round-trip exactly; no
    // tolerance needed. Concurrency is meaningful even single-writer: the
    // conformance case runs the promises against one connection.
    skip: {},
  });
}
