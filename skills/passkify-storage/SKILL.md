---
name: passkify-storage
description: Persist passkify data — the PasskeyStore interface, the shipped Postgres, Prisma, Drizzle, Redis, MongoDB and SQLite adapters, the SQL schema, and the conformance suite for verifying a custom store. Use when moving off MemoryStore, wiring passkify to a database, writing a custom PasskeyStore, or debugging intermittent challenge_not_found errors. Not for server configuration (see passkify-server).
license: MIT
---

# Storage

`MemoryStore` is for development only. Across more than one worker, a challenge
issued by one process is redeemed by another that has never seen it, and the
symptom is intermittent `challenge_not_found` under load — which looks like a
passkify bug and is not.

## Use a shipped adapter

```ts
import { Pool } from 'pg';
import { postgresStore } from 'passkify/stores/postgres';
const store = postgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));

import { prismaStore } from 'passkify/stores/prisma';
const store = prismaStore(prisma);

import { redisStore } from 'passkify/stores/redis';
const store = redisStore(redis);

import { mongoStore } from 'passkify/stores/mongodb';
const store = mongoStore(db);

import { DatabaseSync } from 'node:sqlite';
import { sqliteStore } from 'passkify/stores/sqlite';
const store = sqliteStore(new DatabaseSync('passkeys.db'));
```

None of these makes the driver a dependency of passkify — each takes the client
you already have, and imports its types only.

**Drizzle:** use `postgresStore` with the pool Drizzle is already using. A
separate adapter would add nothing, because the schema and the queries are the
same.

## The schema

```ts
import { POSTGRES_SCHEMA, SQLITE_SCHEMA, PRISMA_SCHEMA } from 'passkify/stores/schema';
```

Three things in it are load-bearing:

- **`passkey_users.id` is `text`, not a generated key.** It is the WebAuthn user
  handle: the authenticator stores it and hands it back on every usernameless
  login, so it must be exactly the value passkify supplied.
- **`passkey_challenges` has no foreign key to users.** A registration challenge
  is issued *before* the account exists, which is what lets a failed
  registration leave no trace.
- **Index `expires_at`.** Sweeping expired challenges is otherwise a table scan
  on the busiest table you have. Redis and MongoDB expire them natively.

## Writing your own

Ten methods. Three have requirements the type signature cannot express, and all
three are security-relevant.

**`takeChallenge` must fetch and delete atomically.** A `SELECT` followed by a
`DELETE` lets two concurrent requests both receive the same challenge, which is
exactly the replay the challenge exists to prevent.

| Engine | The atomic form |
| --- | --- |
| Postgres / SQLite | `DELETE FROM passkey_challenges WHERE challenge = $1 RETURNING *` |
| Redis | `GETDEL` |
| MongoDB | `findOneAndDelete` |
| Prisma | `delete()` — one statement, not `findUnique` then `delete` |

It must also return `null` for an expired challenge **and delete it**, and
return `null` rather than throwing for an unknown key.

**`createUser` must persist `input.id` verbatim.** Generating your own id is the
most destructive store bug there is: usernameless login silently never finds the
account, and only for discoverable credentials, so it looks intermittent.

**Usernames must be unique under concurrency.** A unique index, not a
read-then-write check.

## Verify it

```ts
import { test } from 'vitest';
import { runStoreConformance } from 'passkify/store-conformance';

runStoreConformance({
  test,
  createStore: async () => {
    const db = await freshDatabase();
    return { store: myStore(db), cleanup: () => db.end() };
  },
});
```

Nineteen cases, each with the consequence of failing it written out. It includes
a genuine concurrency race against `takeChallenge`, which is what catches a
read-then-delete implementation — and that case is itself tested against a
deliberately broken store, so it is known to fail things.

Case-insensitive `getUserByUsername` is marked *recommended*, not required: a
plain unique index is case-sensitive and that is a defensible choice. Decide it
knowingly, because otherwise `Ada` and `ada` are two accounts.

## Do not do this

```ts
// ✗ Two concurrent logins both succeed. This is replay.
async takeChallenge(challenge) {
  const found = await db.get(challenge);
  await db.delete(challenge);
  return found;
}

// ✓ One statement
async takeChallenge(challenge) {
  const { rows } = await db.query(
    'DELETE FROM passkey_challenges WHERE challenge = $1 RETURNING *', [challenge]);
  return rows[0] ?? null;
}
```

```ts
// ✗ Usernameless login will never find this account again
async createUser(input) {
  return db.users.create({ id: crypto.randomUUID(), username: input.username });
}

// ✓ The id is the WebAuthn user handle
async createUser(input) {
  return db.users.create({ id: input.id, username: input.username });
}
```
