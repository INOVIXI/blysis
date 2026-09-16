-- The bookkeeping a single role per member needed is gone.
--
-- `TimedRoleGrant` existed to answer one question: when a role handed out for
-- thirty days lapses, what does the member go back to? That question only
-- exists because a member held exactly one role, so handing one over replaced
-- what they were. `UserRole` holds a set, the lapsed row is deleted, and the
-- rest of the set is untouched - there is nothing to put back.
--
-- WHAT IS LOST: `previousRoleId`, the role a member held before a timed grant
-- was written. That is acceptable because it now describes nothing: the
-- member never stopped holding it. Migration 001 copied every live grant into
-- `UserRole` with the expiry it carried, so no member loses time they paid
-- for, and an expired grant described a member who had already been reverted.
--
-- Run after 001, which is the one that copied the rows.

DROP TABLE IF EXISTS "TimedRoleGrant";
