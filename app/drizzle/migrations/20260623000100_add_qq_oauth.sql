-- Add QQ OAuth (QQ互联) support
ALTER TABLE "SystemSettings"
  ADD COLUMN "qqOAuthEnabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN "qqClientId" text,
  ADD COLUMN "qqClientSecret" text;
