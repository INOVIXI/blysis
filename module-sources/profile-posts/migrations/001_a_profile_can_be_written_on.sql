-- A profile can be written on.
--
-- Two tables and one column on User. The column defaults to true because the
-- feature arrives switched on for a site that installs it, and a member who
-- wants their wall shut turns it off; an operator who wants it shut for
-- everybody turns the module off, which is what a module is for.
CREATE TABLE IF NOT EXISTS "ProfilePost" (
    "id"            TEXT NOT NULL,
    "profileUserId" TEXT NOT NULL,
    "authorId"      TEXT NOT NULL,
    "body"          TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProfilePost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProfilePostReply" (
    "id"        TEXT NOT NULL,
    "postId"    TEXT NOT NULL,
    "authorId"  TEXT NOT NULL,
    "body"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfilePostReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProfilePost_profileUserId_createdAt_idx" ON "ProfilePost"("profileUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProfilePost_authorId_idx" ON "ProfilePost"("authorId");
CREATE INDEX IF NOT EXISTS "ProfilePostReply_postId_createdAt_idx" ON "ProfilePostReply"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProfilePostReply_authorId_idx" ON "ProfilePostReply"("authorId");

ALTER TABLE "ProfilePost" DROP CONSTRAINT IF EXISTS "ProfilePost_profileUserId_fkey";
ALTER TABLE "ProfilePost" ADD CONSTRAINT "ProfilePost_profileUserId_fkey"
    FOREIGN KEY ("profileUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePost" DROP CONSTRAINT IF EXISTS "ProfilePost_authorId_fkey";
ALTER TABLE "ProfilePost" ADD CONSTRAINT "ProfilePost_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePostReply" DROP CONSTRAINT IF EXISTS "ProfilePostReply_postId_fkey";
ALTER TABLE "ProfilePostReply" ADD CONSTRAINT "ProfilePostReply_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "ProfilePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePostReply" DROP CONSTRAINT IF EXISTS "ProfilePostReply_authorId_fkey";
ALTER TABLE "ProfilePostReply" ADD CONSTRAINT "ProfilePostReply_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileWallOpen" BOOLEAN NOT NULL DEFAULT true;
