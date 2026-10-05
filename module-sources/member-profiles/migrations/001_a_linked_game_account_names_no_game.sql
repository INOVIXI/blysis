-- supersedes-checksum: 2853de351cc8ce1878a981c0c5dee6c3be29562b6032d55495df8a030a3ff928
-- (the text before the table guard, which failed every fresh install with
-- 42P01 "LinkedAccount" does not exist; see supersededChecksums in
-- scripts/apply-migrations.ts)
--
-- A self-declared game account no longer claims to be a Minecraft one.
--
-- The Accounts tab asks for a "Game username" and filed what it was given
-- under the provider "minecraft", which is a game this module knows nothing
-- about: a site here may be a shop, a forum or a community that has never run
-- a server. The module that is about that game ships its own profile tab and
-- proves the account before writing it down.
--
-- Only rows this tab wrote are moved. It is the only writer of the provider,
-- so nothing signed in with an external identity is touched.
--
-- Safe to re-run. On a fresh install there is not even a table: 002 below
-- drops it, and the merged schema never declares it, so the statement only
-- runs where the table is still there.

DO $$
BEGIN
    IF to_regclass('"LinkedAccount"') IS NOT NULL THEN
        UPDATE "LinkedAccount" SET "provider" = 'game' WHERE "provider" = 'minecraft';
    END IF;
END $$;
