# De-Droid - Universal Android Debloater

A comprehensive cross-platform application for removing bloatware and managing packages on non-rooted Android devices. Built with Electron, React, TypeScript frontend and FastAPI backend, featuring wireless pairing, advanced backup management, and detailed package information.


---

## 🏗️ Architecture

**New Hybrid Architecture (v2.0)**: Local ADB Execution + Remote Intelligence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER (Electron)                            │
│                      React + TypeScript + Local ADB                          │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    LOCAL ADB EXECUTION ENGINE                          │  │
│  │  • Runs adb shell pm list packages locally (Node.js child_process)    │  │
│  │  • Executes uninstall/restore/disable/enable commands instantly       │  │
│  │  • Device detection and management (no network latency)               │  │
│  │  • Works OFFLINE - ADB commands execute without server connection     │  │
│  └───────────────────────────┬───────────────────────────────────────────┘  │
│                              │                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Dashboard   │  │   Device     │  │   Package    │  │   Backup &   │    │
│  │  & Status    │  │   Manager    │  │   Manager    │  │   Restore    │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │    Login &   │  │  Wireless    │  │   Settings   │  │   History    │    │
│  │   Register   │  │   Pairing    │  │   & Prefs    │  │   & Logs     │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         └────────────────┬─────────────────┬────────────────┬──────────┘    │
│                    IPC Communication                                         │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │
                    HTTP/REST (Optional)
                         │
       ┌─────────────────┴──────────────────┐
       │                                    │
       ▼                                    ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│   INTELLIGENCE LAYER             │  │   DATA LAYER                     │
│   (Python FastAPI)               │  │   (SQLite/PostgreSQL)            │
│   Port: 8000 (Optional)          │  │                                  │
│                                  │  │  ┌──────────────────────────┐   │
│  ┌────────────────────────────┐  │  │  │  Users & Sessions        │   │
│  │  Authentication & JWT      │  │  │  ├──────────────────────────┤   │
│  ├────────────────────────────┤  │  │  │  Package Safety Database │   │
│  │  Package Safety Checker    │  │  │  │  - Red (Critical/Unsafe) │   │
│  │  - Accepts package list    │  │  │  │  - Yellow (Caution)      │   │
│  │  - Returns safety ratings  │  │  │  │  - Green (Safe)          │   │
│  │  - Red/Yellow/Green flags  │  │  │  ├──────────────────────────┤   │
│  ├────────────────────────────┤  │  │  │  Action History & Logs   │   │
│  │  Debloat Database Lookup   │  │  │  ├──────────────────────────┤   │
│  │  - Package descriptions    │  │  │  │  Package Metadata        │   │
│  │  - Community ratings       │  │  │  ├──────────────────────────┤   │
│  │  - Alternative suggestions │  │  │  │  Backup Snapshots        │   │
│  ├────────────────────────────┤  │  │  └──────────────────────────┘   │
│  │  Event Logging Service     │  │  │                                  │
│  │  - Receives action logs    │  │  │                                  │
│  │  - Tracks user operations  │  │  │                                  │
│  │  - Audit trail             │  │  │                                  │
│  └────────────────────────────┘  │  │                                  │
│                                  │  │                                  │
└──────────────────────────────────┘  └──────────────────────────────────┘

                 ↓ NO SERVER NEEDED ↓
                      
           ┌────────────────────────┐
           │  Android Device        │
           │  (USB or Wireless)     │
           │  ← Direct ADB Commands │
           └────────────────────────┘
```

### Key Architecture Improvements

**1. Local ADB Execution (Muscle)**
- ✅ Electron runs `adb shell pm list packages` locally using Node.js
- ✅ Gets raw list of 200+ packages instantly
- ✅ Executes uninstall/restore commands without server round-trip
- ✅ **Works offline** - No internet required for ADB operations

**2. Python as Intelligence Layer (Brain)**
- ✅ Receives package list from Electron
- ✅ Checks safety database for each package
- ✅ Returns:
  - 🔴 **Red (Critical)**: DO NOT REMOVE - Will brick your phone
  - 🟡 **Yellow (Caution)**: Proceed with caution
  - 🟢 **Green (Safe)**: Safe to remove
- ✅ Provides package descriptions and alternative apps

**3. Smart Uninstall Flow**
1. User clicks "Uninstall" on package (e.g., Facebook)
2. Electron checks safety metadata from previous API call
3. If **Red**: Block action → "This will brick your phone"
4. If **Yellow**: Show warning → User confirms
5. If **Green**: Proceed immediately
6. Electron executes `adb shell pm uninstall -k --user 0 com.facebook` locally
7. On success, sends log event to Python backend (non-blocking)

**4. Offline Support**
- ADB commands work even if Python server is down
- Safety checks return "Unknown" in offline mode
- User can still uninstall with caution
- Event logging queued and sent when connection restored
