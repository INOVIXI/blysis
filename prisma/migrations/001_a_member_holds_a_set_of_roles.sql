-- A member holds a set of roles, not one.
--
-- `User.roleId` said a member had exactly one role, which is why handing out a
-- rank had to remember what to put back: `TimedRoleGrant.previousRoleId`.
-- Selling somebody a rank could therefore take their moderator status away and
-- return it a month later, and two jobs at once could not be expressed at all.
--
-- `UserRole` is the set. `User.roleId` keeps its column and loses its meaning:
-- it is now the role shown for a member, which is the highest-priority one they
-- hold, maintained by `syncDisplayedRole`.
--
-- Additive. Nothing is dropped here: every existing role assignment becomes a
-- row, and every live timed grant becomes a row with the time it already had.
-- `TimedRoleGrant` is emptied of meaning by this migration and removed by the
-- next one, after the code that reads it has moved.

CREATE TABLE IF NOT EXISTS "UserRole" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "roleId"    TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "source"    TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserRole_userId_fkey') THEN
        ALTER TABLE "UserRole"
            ADD CONSTRAINT "UserRole_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserRole_roleId_fkey') THEN
        ALTER TABLE "UserRole"
            ADD CONSTRAINT "UserRole_roleId_fkey"
            FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");
CREATE INDEX IF NOT EXISTS "UserRole_expiresAt_idx" ON "UserRole"("expiresAt");
CREATE INDEX IF NOT EXISTS "UserRole_roleId_idx" ON "UserRole"("roleId");

-- Every member's current role becomes a permanent membership. `source` says
-- where it came from so a reader of the table in a year knows these were not
-- granted one at a time by an operator.
INSERT INTO "UserRole" ("id", "userId", "roleId", "grantedAt", "expiresAt", "source")
SELECT
    gen_random_uuid()::text,
    u."id",
    u."roleId",
    COALESCE(u."createdAt", CURRENT_TIMESTAMP),
    NULL,
    'migrated'
FROM "User" u
WHERE u."roleId" IS NOT NULL
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- A live timed grant becomes the same row with the time it already carried.
-- `previousRoleId` is not carried over and is not needed: the member keeps
-- whatever else they hold, so there is nothing to put back.
--
-- Only where there is one to carry. `TimedRoleGrant` exists on a site that is
-- being upgraded and has never existed on a site being installed today, and
-- reading it unguarded made every fresh install fail here with `relation
-- "TimedRoleGrant" does not exist` - the migration runner stopped on it, so
-- the database was left with none of the migrations after this one. The next
-- migration already drops the table with `IF EXISTS`; this is the same
-- question asked on the way in.
--
-- Through EXECUTE because PL/pgSQL resolves a table name when the statement
-- first runs, and a branch that is never taken must not need the table to
-- exist for the block to be valid.
DO $$
BEGIN
    IF to_regclass('"TimedRoleGrant"') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO "UserRole" ("id", "userId", "roleId", "grantedAt", "expiresAt", "source")
            SELECT
                gen_random_uuid()::text,
                g."userId",
                g."roleId",
                g."createdAt",
                g."expiresAt",
                g."source"
            FROM "TimedRoleGrant" g
            WHERE g."expiresAt" > CURRENT_TIMESTAMP
            ON CONFLICT ("userId", "roleId") DO UPDATE
                SET "expiresAt" = EXCLUDED."expiresAt",
                    "source"    = EXCLUDED."source"
        $sql$;
    END IF;
END $$;
