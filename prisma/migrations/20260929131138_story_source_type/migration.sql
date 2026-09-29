-- Three ways to ask for a print: a file, a link, or a description.
--
-- WHAT THIS TOUCHES: the "story" table only. Existing rows keep their files
-- and are backfilled as sourceType 'file'; new link / description tickets
-- carry no bytes, so the file columns become nullable.
CREATE TYPE "SourceType" AS ENUM ('file', 'link', 'description');

ALTER TABLE "story" ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'file';
ALTER TABLE "story" ADD COLUMN     "sourceUrl" TEXT;
ALTER TABLE "story" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

ALTER TABLE "story" ALTER COLUMN "filename" DROP NOT NULL;
ALTER TABLE "story" ALTER COLUMN "fileSize" DROP NOT NULL;
ALTER TABLE "story" ALTER COLUMN "mimeType" DROP NOT NULL;
ALTER TABLE "story" ALTER COLUMN "storageKey" DROP NOT NULL;
