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
-- Safe on a fresh install, where there is nothing to move, and safe to re-run.

UPDATE "LinkedAccount" SET "provider" = 'game' WHERE "provider" = 'minecraft';
