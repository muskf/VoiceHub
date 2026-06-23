-- Add email registration toggle
ALTER TABLE "SystemSettings"
  ADD COLUMN "allowEmailRegistration" boolean DEFAULT false NOT NULL;
