-- CreateEnum
CREATE TYPE "DebloatStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('ACCESS', 'REFRESH', 'EMAIL_VERIFICATION');

-- CreateEnum
CREATE TYPE "PackageCategory" AS ENUM ('BLOATWARE', 'SOCIAL_MEDIA', 'GOOGLE_APPS', 'SAMSUNG_APPS', 'XIAOMI_APPS', 'SYSTEM_UI', 'CARRIER', 'PRODUCTIVITY', 'ENTERTAINMENT', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "PackagePriority" AS ENUM ('ESSENTIAL', 'IMPORTANT', 'OPTIONAL', 'DEBLOATABLE', 'BLOATWARE');

-- CreateEnum
CREATE TYPE "ErrorType" AS ENUM ('ADB_CONNECTION', 'ADB_COMMAND', 'DEVICE_NOT_FOUND', 'PACKAGE_NOT_FOUND', 'PERMISSION_DENIED', 'AUTHENTICATION', 'VALIDATION', 'DATABASE', 'NETWORK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('UNINSTALL', 'DISABLE', 'ENABLE', 'REINSTALL');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaasswordReset" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PaasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "androidVersion" TEXT NOT NULL,
    "sdkVersion" INTEGER NOT NULL,
    "serialNumber" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "description" TEXT,
    "category" "PackageCategory" NOT NULL,
    "priority" "PackagePriority" NOT NULL,
    "isSystemApp" BOOLEAN NOT NULL DEFAULT false,
    "isSafeToRemove" BOOLEAN NOT NULL DEFAULT true,
    "warningMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePackage" (
    "id" TEXT NOT NULL,
    "isInstalled" BOOLEAN NOT NULL DEFAULT true,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "deviceId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,

    CONSTRAINT "DevicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebloatSession" (
    "id" TEXT NOT NULL,
    "status" "DebloatStatus" NOT NULL DEFAULT 'PENDING',
    "totalPackages" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "DebloatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebloatAction" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "DebloatAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorType" "ErrorType" NOT NULL,
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "context" JSONB,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Token_token_key" ON "Token"("token");

-- CreateIndex
CREATE INDEX "Token_token_idx" ON "Token"("token");

-- CreateIndex
CREATE INDEX "Token_userId_idx" ON "Token"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaasswordReset_token_key" ON "PaasswordReset"("token");

-- CreateIndex
CREATE INDEX "PaasswordReset_token_idx" ON "PaasswordReset"("token");

-- CreateIndex
CREATE INDEX "PaasswordReset_userId_idx" ON "PaasswordReset"("userId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_serialNumber_key" ON "Device"("userId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Package_packageName_key" ON "Package"("packageName");

-- CreateIndex
CREATE INDEX "Package_packageName_idx" ON "Package"("packageName");

-- CreateIndex
CREATE INDEX "Package_priority_idx" ON "Package"("priority");

-- CreateIndex
CREATE INDEX "Package_category_idx" ON "Package"("category");

-- CreateIndex
CREATE INDEX "DevicePackage_deviceId_idx" ON "DevicePackage"("deviceId");

-- CreateIndex
CREATE INDEX "DevicePackage_packageId_idx" ON "DevicePackage"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePackage_deviceId_packageId_key" ON "DevicePackage"("deviceId", "packageId");

-- CreateIndex
CREATE INDEX "DebloatSession_userId_idx" ON "DebloatSession"("userId");

-- CreateIndex
CREATE INDEX "DebloatSession_deviceId_idx" ON "DebloatSession"("deviceId");

-- CreateIndex
CREATE INDEX "DebloatSession_status_idx" ON "DebloatSession"("status");

-- CreateIndex
CREATE INDEX "DebloatAction_sessionId_idx" ON "DebloatAction"("sessionId");

-- CreateIndex
CREATE INDEX "ErrorLog_errorType_idx" ON "ErrorLog"("errorType");

-- CreateIndex
CREATE INDEX "ErrorLog_userId_idx" ON "ErrorLog"("userId");

-- CreateIndex
CREATE INDEX "ErrorLog_deviceId_idx" ON "ErrorLog"("deviceId");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_key_key" ON "AppConfig"("key");

-- CreateIndex
CREATE INDEX "AppConfig_key_idx" ON "AppConfig"("key");

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaasswordReset" ADD CONSTRAINT "PaasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePackage" ADD CONSTRAINT "DevicePackage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePackage" ADD CONSTRAINT "DevicePackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebloatSession" ADD CONSTRAINT "DebloatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebloatSession" ADD CONSTRAINT "DebloatSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebloatAction" ADD CONSTRAINT "DebloatAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DebloatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DebloatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
