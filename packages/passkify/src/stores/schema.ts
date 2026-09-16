/**
 * The schema, as a string, so it can be printed, written to a migration, or
 * pasted into a console without a build step.
 *
 * Three things here are load-bearing rather than stylistic:
 *
 * `passkey_users.id` is `text`, not a generated key. It is the WebAuthn user
 * handle: the authenticator stores it and hands it back on every usernameless
 * login, so it has to be exactly the value passkify supplied.
 *
 * `passkey_challenges` has no foreign key to users. A registration challenge is
 * issued *before* the account exists, which is what lets a failed registration
 * leave no trace.
 *
 * The index on `expires_at` is for the sweeper. Without it, deleting expired
 * challenges is a table scan on the busiest table you have.
 */

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS passkey_users (
  id            text PRIMARY KEY,
  username      text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness. A plain UNIQUE(username) is also defensible;
-- it means "Ada" and "ada" are two accounts, which users discover the
-- confusing way.
CREATE UNIQUE INDEX IF NOT EXISTS passkey_users_username_key
  ON passkey_users (lower(username));

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES passkey_users(id) ON DELETE CASCADE,
  public_key    text NOT NULL,
  algorithm     integer NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[],
  device_type   text NOT NULL,
  backed_up     boolean NOT NULL DEFAULT false,
  aaguid        text,
  nickname      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE INDEX IF NOT EXISTS passkey_credentials_user_id_idx
  ON passkey_credentials (user_id, created_at);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge   text PRIMARY KEY,
  kind        text NOT NULL,
  user_id     text,
  context     jsonb,
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS passkey_challenges_expires_at_idx
  ON passkey_challenges (expires_at);
`.trim();

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS passkey_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS passkey_users_username_key
  ON passkey_users (lower(username));

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES passkey_users(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,
  algorithm     INTEGER NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  device_type   TEXT NOT NULL,
  backed_up     INTEGER NOT NULL DEFAULT 0,
  aaguid        TEXT,
  nickname      TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

CREATE INDEX IF NOT EXISTS passkey_credentials_user_id_idx
  ON passkey_credentials (user_id, created_at);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge   TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  user_id     TEXT,
  context     TEXT,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS passkey_challenges_expires_at_idx
  ON passkey_challenges (expires_at);
`.trim();

/** The Prisma models, for pasting into a `schema.prisma`. */
export const PRISMA_SCHEMA = `
model PasskeyUser {
  id          String              @id
  username    String              @unique
  displayName String
  createdAt   DateTime            @default(now())
  credentials PasskeyCredential[]

  @@map("passkey_users")
}

model PasskeyCredential {
  id         String      @id
  userId     String
  user       PasskeyUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  publicKey  String
  algorithm  Int
  counter    BigInt      @default(0)
  transports String[]
  deviceType String
  backedUp   Boolean     @default(false)
  aaguid     String?
  nickname   String?
  createdAt  DateTime    @default(now())
  lastUsedAt DateTime?

  @@index([userId, createdAt])
  @@map("passkey_credentials")
}

model PasskeyChallenge {
  challenge String   @id
  kind      String
  userId    String?
  context   Json?
  expiresAt DateTime

  @@index([expiresAt])
  @@map("passkey_challenges")
}
`.trim();
