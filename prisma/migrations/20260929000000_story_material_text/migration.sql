-- Filament type becomes free-form text for Bambuddy-backed stock.
--
-- WHAT THIS TOUCHES: the "story" table only. Existing rows keep their
-- material ('PLA' | 'PETG' | 'TPU' | 'Resin'), now stored as text; new
-- tickets may carry any material Bambuddy reports (ABS, ASA, PC, PA, …).
-- The old "Material" enum is dropped as nothing references it any more.
ALTER TABLE "story" ALTER COLUMN "material" TYPE TEXT USING "material"::text;
ALTER TABLE "story" ALTER COLUMN "material" SET DEFAULT 'PETG';
DROP TYPE "Material";
