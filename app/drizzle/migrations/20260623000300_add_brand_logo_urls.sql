-- Add brand logo URL fields
ALTER TABLE "SystemSettings"
  ADD COLUMN "brandLogoPngUrl" text,
  ADD COLUMN "brandLogo144Url" text,
  ADD COLUMN "brandLogoSvgUrl" text;
