I'll help you design a comprehensive Prisma schema for your de-droid application. Based on your requirements, here's a complete schema covering all the features: 

```prisma name=schema. prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ==================== USER MANAGEMENT ====================

model User {
  id                String    @id @default(uuid())
  username          String    @unique
  email             String    @unique
  password          String    // Hashed password
  firstName         String? 
  lastName          String?
  isActive          Boolean   @default(true)
  isVerified        Boolean   @default(false)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  lastLoginAt       DateTime? 

  // Relations
  tokens            Token[]
  passwordResets    PasswordReset[]
  devices           Device[]
  debloatSessions   DebloatSession[]
  errorLogs         ErrorLog[]

  @@index([email])
  @@index([username])
}

model Token {
  id          String    @id @default(uuid())
  token       String    @unique
  type        TokenType
  expiresAt   DateTime
  isRevoked   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  
  // Relations
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([token])
  @@index([userId])
}

enum TokenType {
  ACCESS
  REFRESH
  EMAIL_VERIFICATION
}

model PasswordReset {
  id          String   @id @default(uuid())
  token       String   @unique
  expiresAt   DateTime
  isUsed      Boolean  @default(false)
  createdAt   DateTime @default(now())
  
  // Relations
  userId      String
  user        User     @relation(fields:  [userId], references:  [id], onDelete: Cascade)

  @@index([token])
  @@index([userId])
}

// ==================== DEVICE MANAGEMENT ====================

model Device {
  id              String       @id @default(uuid())
  deviceName      String       // e.g., "Samsung Galaxy S21"
  manufacturer    String       // e.g., "Samsung"
  model           String       // e. g., "SM-G991B"
  androidVersion  String       // e.g., "13"
  sdkVersion      Int          // e.g., 33
  serialNumber    String? 
  isConnected     Boolean      @default(false)
  lastConnectedAt DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  // Relations
  userId          String
  user            User         @relation(fields:  [userId], references:  [id], onDelete: Cascade)
  packages        DevicePackage[]
  debloatSessions DebloatSession[]
  errorLogs       ErrorLog[]

  @@unique([userId, serialNumber])
  @@index([userId])
}

// ==================== PACKAGE MANAGEMENT ====================

model Package {
  id              String          @id @default(uuid())
  packageName     String          @unique  // e.g., "com.facebook.katana"
  appName         String          // e.g., "Facebook"
  description     String?
  category        PackageCategory
  priority        PackagePriority
  isSystemApp     Boolean         @default(false)
  isSafeToRemove  Boolean         @default(true)
  warningMessage  String?         // Warning if risky to remove
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  // Relations
  devicePackages  DevicePackage[]

  @@index([packageName])
  @@index([priority])
  @@index([category])
}

enum PackageCategory {
  BLOATWARE
  SOCIAL_MEDIA
  GOOGLE_APPS
  SAMSUNG_APPS
  XIAOMI_APPS
  SYSTEM_UI
  CARRIER
  PRODUCTIVITY
  ENTERTAINMENT
  SECURITY
  OTHER
}

enum PackagePriority {
  ESSENTIAL      // Critical system packages - DO NOT REMOVE
  IMPORTANT      // Important for device functionality
  OPTIONAL       // Can be removed but may affect some features
  DEBLOATABLE    // Safe to remove, recommended for debloating
  BLOATWARE      // Recommended to remove
}

// Junction table for Device-Package (many-to-many with extra fields)
model DevicePackage {
  id              String        @id @default(uuid())
  isInstalled     Boolean       @default(true)
  isDisabled      Boolean       @default(false)
  isSelected      Boolean       @default(false)  // Selected for removal
  installedAt     DateTime? 
  removedAt       DateTime? 
  disabledAt      DateTime?
  
  // Relations
  deviceId        String
  device          Device        @relation(fields:  [deviceId], references: [id], onDelete: Cascade)
  packageId       String
  package         Package       @relation(fields:  [packageId], references: [id], onDelete: Cascade)

  @@unique([deviceId, packageId])
  @@index([deviceId])
  @@index([packageId])
}

// ==================== DEBLOAT SESSION ====================

model DebloatSession {
  id              String              @id @default(uuid())
  status          DebloatStatus       @default(PENDING)
  totalPackages   Int                 @default(0)
  removedCount    Int                 @default(0)
  failedCount     Int                 @default(0)
  skippedCount    Int                 @default(0)
  startedAt       DateTime? 
  completedAt     DateTime? 
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  // Relations
  userId          String
  user            User                @relation(fields:  [userId], references:  [id], onDelete: Cascade)
  deviceId        String
  device          Device              @relation(fields: [deviceId], references:  [id], onDelete: Cascade)
  actions         DebloatAction[]
  errorLogs       ErrorLog[]

  @@index([userId])
  @@index([deviceId])
  @@index([status])
}

enum DebloatStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
  CANCELLED
}

model DebloatAction {
  id              String            @id @default(uuid())
  packageName     String
  actionType      ActionType
  status          ActionStatus      @default(PENDING)
  errorMessage    String? 
  executedAt      DateTime? 
  createdAt       DateTime          @default(now())

  // Relations
  sessionId       String
  session         DebloatSession    @relation(fields:  [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
}

enum ActionType {
  UNINSTALL
  DISABLE
  ENABLE
  REINSTALL
}

enum ActionStatus {
  PENDING
  SUCCESS
  FAILED
  SKIPPED
}

// ==================== ERROR LOGGING ====================

model ErrorLog {
  id              String        @id @default(uuid())
  errorCode       String? 
  errorType       ErrorType
  message         String
  stackTrace      String? 
  context         Json?         // Additional context data
  isResolved      Boolean       @default(false)
  createdAt       DateTime      @default(now())

  // Relations
  userId          String? 
  user            User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  deviceId        String? 
  device          Device?        @relation(fields:  [deviceId], references: [id], onDelete: SetNull)
  sessionId       String?
  session         DebloatSession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@index([errorType])
  @@index([userId])
  @@index([deviceId])
  @@index([createdAt])
}

enum ErrorType {
  ADB_CONNECTION
  ADB_COMMAND
  DEVICE_NOT_FOUND
  PACKAGE_NOT_FOUND
  PERMISSION_DENIED
  AUTHENTICATION
  VALIDATION
  DATABASE
  NETWORK
  UNKNOWN
}

// ==================== APP CONFIGURATION ====================

model AppConfig {
  id          String   @id @default(uuid())
  key         String   @unique
  value       String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([key])
}
```

---

## Schema Overview

### 📦 Models Included:

| Model | Purpose |
|-------|---------|
| **User** | User registration, authentication |
| **Token** | JWT access/refresh tokens, email verification |
| **PasswordReset** | Forgot password functionality |
| **Device** | Android device info (manufacturer, model, Android version) |
| **Package** | Master list of all Android packages with priority levels |
| **DevicePackage** | Tracks which packages are on which device + their status |
| **DebloatSession** | Tracks each debloat operation |
| **DebloatAction** | Individual package actions within a session |
| **ErrorLog** | All errors (ADB, connection, permissions, etc.) |
| **AppConfig** | App-wide configuration settings |

### 🎯 Priority Levels:

| Priority | Description |
|----------|-------------|
| `ESSENTIAL` | Critical system packages - DO NOT REMOVE |
| `IMPORTANT` | Important for device functionality |
| `OPTIONAL` | Can be removed but may affect features |
| `DEBLOATABLE` | Safe to remove |
| `BLOATWARE` | Recommended to remove |

---

## Next Steps

After adding this schema: 

```bash
cd backend-nestjs

# Generate Prisma client
npm run prisma:generate

# Create migration
npm run prisma:migrate
```

Would you like me to: 
1. **Update the issue** in `virtualabishek/de-droid` with this schema for your collaborator? 
2. **Add seed data** with common bloatware packages (Samsung, Xiaomi, Google apps)?
3. **Create a PR** to add this schema to your `virtualabishek/de-droid-demo` repository?