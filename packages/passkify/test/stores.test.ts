/**
 * Shipped store adapters, against the same conformance suite users run.
 *
 * SQLite is exercised for real here, because Node ships one — which makes this
 * the test that proves the suite works against an actual database rather than
 * only against an in-memory map. Postgres, Redis and MongoDB need services and
 * run in CI.
 */

import { test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

import { runStoreConformance } from '#internal/conformance/index.js';
import { sqliteStore } from '#internal/stores/sqlite.js';

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
