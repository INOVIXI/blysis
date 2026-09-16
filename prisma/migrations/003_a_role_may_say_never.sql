-- A role says one of three things about a permission: yes, never, or nothing.
--
-- It used to say one: a row in the join table meant yes, and its absence meant
-- nothing. A member holds a set of roles and may do the union of what they
-- allow, so without a refusal an operator can only ever build up - taking
-- posting away from one person means unpicking every role they hold, and
-- putting it back afterwards means remembering what they were.
--
-- `NEVER` is absolute: it beats a yes from any other role the member holds.
-- That is what makes a restricted role - "muted", "on probation" - a thing an
-- operator can write once and hand out.
--
-- Keyed by the permission's name rather than by a row in a table of names. The
-- vocabulary comes from core and from the installed manifests; a table of
-- names is a second copy that has to be kept in step, and was not: `Permission`
-- held four rows on an installation whose manifests declare a hundred and
-- three.
--
-- WHAT IS LOST: `Permission.description`, which nothing read - the roles screen
-- shows the name - and the `Permission` rows themselves, whose names are
-- carried over below wherever a role actually granted one.

CREATE TABLE IF NOT EXISTS "RolePermission" (
    "id"         TEXT NOT NULL,
    "roleId"     TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "state"      TEXT NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PermissionState') THEN
        CREATE TYPE "PermissionState" AS ENUM ('ALLOW', 'NEVER');
    END IF;
END $$;

ALTER TABLE "RolePermission"
    ALTER COLUMN "state" TYPE "PermissionState" USING "state"::"PermissionState";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RolePermission_roleId_fkey') THEN
        ALTER TABLE "RolePermission"
            ADD CONSTRAINT "RolePermission_roleId_fkey"
            FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_roleId_permission_key"
    ON "RolePermission"("roleId", "permission");
CREATE INDEX IF NOT EXISTS "RolePermission_permission_idx" ON "RolePermission"("permission");

-- Every grant that existed becomes a yes. Written defensively because an
-- installation created after the schema change has neither old table.
DO $$
BEGIN
    IF to_regclass('"_PermissionToRole"') IS NOT NULL AND to_regclass('"Permission"') IS NOT NULL THEN
        INSERT INTO "RolePermission" ("id", "roleId", "permission", "state")
        SELECT gen_random_uuid()::text, j."B", p."name", 'ALLOW'::"PermissionState"
        FROM "_PermissionToRole" j
        JOIN "Permission" p ON p."id" = j."A"
        ON CONFLICT ("roleId", "permission") DO NOTHING;
    END IF;
END $$;

DROP TABLE IF EXISTS "_PermissionToRole";
DROP TABLE IF EXISTS "Permission";
