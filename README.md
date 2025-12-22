# De-Droid -   Debloat Android

A application for removing bloatware from non-rooted Android devices. Built with Electron for cross platform app, NestJS for the backend, and FastAPI for the adb connections.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   FRONTEND                                       │
│                         Electron + TypeScript + React                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Device    │  │   Package   │  │   User      │  │   Settings  │             │
│  │   Manager   │  │   List      │  │   Auth      │  │   Panel     │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └────────────────┴────────────────┴────────────────┘                     │
│                                    │                                             │
│                          IPC (Electron Bridge)                                   │
└────────────────────────────────────┼─────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
┌───────────────────────────────────┐  ┌────────────────────────────────────────────┐
│         NODE.JS BACKEND           │  │            PYTHON ADB SERVICE              │
│      (NestJS + Prisma + JWT)      │  │         (FastAPI + Subprocess)             │
│         Port: 3000                │  │              Port: 8000                    │
└───────────────────────────────────┘  └────────────────────────────────────────────┘
              │                                        │
              ▼                                        ▼
┌───────────────────────────────────┐  ┌────────────────────────────────────────────┐
│         PostgreSQL                │  │            Android Device                  │
│         Database                  │  │            (via USB + ADB)                 │
└───────────────────────────────────┘  └────────────────────────────────────────────┘
```

## 📁 Project Structure

```
de-droid/
├── frontend/                      # Electron ( TypeScript with react)
│   ├── src/
│   │   ├── main/                  # Electron main process
│   │   ├── renderer/              # React frontend
│   │   └── preload/               # Electron preload scripts
│   └── package.json
│
├── backend-node/                  # NestJS Backend
│   ├── src/
│   │   ├── auth/                  # Authentication module
│   │   ├── users/                 # User management
│   │   ├── devices/               # Device management
│   │   ├── history/               # Action history
│   │   ├── backups/               # Backup management
│   │   └── prisma/                # Database service
│   ├── prisma/
│   │   └── schema.prisma          # Database schema
│   └── package.json
│
├── backend-python/                # Python ADB Service
│   ├── app/
│   │   ├── core/                  # ADB command wrappers
│   │   ├── api/                   # API routes
│   │   └── main.py                # FastAPI entry point
│   └── requirements.txt
│
├── shared/                        # Shared types/contracts
│   └── types/
│
├── docker-compose.yml             # PostgreSQL setup
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** 
- **Python** 
- **PostgreSQL** 
- **Android Platform Tools** (ADB) installed and in PATH
- **pnpm** or **npm** or **bun**

### Installation

#### 1. Start PostgreSQL (using Docker)

```bash
# start postgress container
sudo docker start postgres

# start the bash
sudo docker exec -it postgres bash

# make the database. 

psql -u username -d yourdefaultdb

# create database

CREATE DATABASE dedroid;

# Other part will handle by prisma ORM. run prisma from the backend-nestjs

```

#### 2. Setup Backend (NestJS)

```bash
cd backend-node

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Start development server
npm run start:dev
```

#### 3. Setup Python ADB Service

```bash
cd backend-python

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Linux/macOS:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the service
uvicorn app.main:app --reload --port 8000
```

#### 4. Setup Frontend (Electron + React)

```bash
cd frontend

# Install dependencies
npm install

# Start development mode
npm run dev
```


## 🗄️ Database Schema

The application uses PostgreSQL with Prisma ORM. Key models:

- **User**: Authentication and profile
- **UserSettings**: User preferences
- **Device**: Connected Android devices
- **ActionHistory**: Package action logs
- **Backup**: Device package state backups
- **DebloatList**: Package removal recommendations

## 🔧 Configuration

### Environment Variables

Create a `.env` file in `backend-node/`:

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dedroid?schema=public"

# JWT Secrets (change in production!)
JWT_ACCESS_SECRET=your-super-secret-access-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key

# Server
PORT=3000
NODE_ENV=development
```

## 📱 Using ADB

The application uses ADB (Android Debug Bridge) to communicate with Android devices. Ensure:

1. USB debugging is enabled on your device
2. The device is connected via USB
3. You've authorized the computer on your device



