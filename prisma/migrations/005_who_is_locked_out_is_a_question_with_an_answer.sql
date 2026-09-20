-- Who is locked out right now.
--
-- `lockedUntil` was read in one file and written in the same one, so nothing
-- ever asked the table this question: a member who fat-fingered their password
-- past the threshold waited the lock out, and the operator they wrote to had
-- no way to help. The security screen asks it now.
--
-- Almost every row is null, so this exists for the handful that are not. A
-- full scan of every account to find three of them is the wrong price for a
-- screen an operator opens when somebody writes in.
--
-- Additive: an index, nothing touched, nothing lost.

CREATE INDEX IF NOT EXISTS "User_lockedUntil_idx" ON "User" ("lockedUntil");
