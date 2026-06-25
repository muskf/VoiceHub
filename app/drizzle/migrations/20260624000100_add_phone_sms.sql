-- Add phone number fields to users
ALTER TABLE "User"
  ADD COLUMN "phone" text,
  ADD COLUMN "phoneVerified" boolean DEFAULT false;

-- Add SMS configuration to SystemSettings
ALTER TABLE "SystemSettings"
  ADD COLUMN "smsEnabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN "smsProvider" text DEFAULT 'aliyun',
  ADD COLUMN "smsAliyunAccessKeyId" text,
  ADD COLUMN "smsAliyunAccessKeySecret" text,
  ADD COLUMN "smsAliyunSignName" text,
  ADD COLUMN "smsAliyunTemplateCode" text,
  ADD COLUMN "allowPhoneRegistration" boolean DEFAULT false NOT NULL;
