---
name: Drizzle schema ownership
description: How the DB schema is managed (Drizzle, no startup DDL) and the jsonb-string insert gotcha.
---

# Drizzle is the schema source of truth

The DB schema lives in `src/database/schema.ts` (Drizzle). There is **no
startup-time DDL** — the app assumes the tables already exist. Do NOT
reintroduce `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN` at boot.

**Why:** startup DDL self-heals prod and bypasses Replit's Publish-time schema
diff (which prompts the user to confirm renames, preventing drop+add data loss).

**How to apply:**
- Dev schema is applied by `scripts/post-merge.sh` running `db:push -- --force`
  after install. Prod is updated only via the user re-publishing (Publish diff).
- Column changes go in `schema.ts` + a migration plan, never via boot-time DDL.
- One shared pg Pool + Drizzle client in `src/database/db.ts`; don't spin up
  per-class `new Pool(...)`.

## jsonb pre-serialized-string insert gotcha

DecisionLogger keeps its JSON blobs as **pre-serialized strings** (a deliberate
memory win — lets the live object graphs GC immediately). When inserting these
into a Drizzle `jsonb` column, pass them via `sql\`${jsonString}::jsonb\``, NOT
as a plain value. Drizzle JSON.stringify's plain values, so a string would get
**double-encoded**. Raw pg tolerated the bare string (implicit text→jsonb cast);
Drizzle does not.
