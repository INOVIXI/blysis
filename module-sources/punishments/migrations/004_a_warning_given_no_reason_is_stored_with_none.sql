-- A warning given no reason is stored with none.
--
-- A warning-type punishment also writes the member's warning row, and when the
-- moderator left the reason empty this module wrote "No reason provided" into
-- it. The warnings screen prints the column as it is, so that English reached
-- every admin whatever their language, and as data no translation could
-- change it. The module writes an empty reason now and the screen words it.
--
-- Only this module's own placeholder is touched, and only the exact text it
-- wrote: a reason somebody typed is theirs. Running it twice changes nothing.

UPDATE "UserWarning" SET "reason" = '' WHERE "reason" = 'No reason provided';
