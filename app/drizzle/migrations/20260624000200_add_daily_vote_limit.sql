-- Add daily vote limit setting
ALTER TABLE "SystemSettings"
  ADD COLUMN "dailyVoteLimit" integer DEFAULT 3 NOT NULL;
