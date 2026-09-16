/**
 * MemoryStore against the conformance suite.
 *
 * The shipped store has to pass the same bar as anyone else's, or the suite is
 * documentation rather than a contract.
 */

import { test } from 'vitest';
import { MemoryStore } from 'passkify/server';
import { runStoreConformance } from '#internal/conformance/index.js';

runStoreConformance({
  test,
  createStore: async () => ({ store: new MemoryStore() }),
});
