# De-Droid - Android Debloater

A fully local Electron desktop application for removing bloatware from Android devices.

## Architecture

This application runs **entirely locally** with no external backend required:

- **Electron** - Desktop application framework
- **SQLite** (via better-sqlite3) - Local data storage for history, backups, and settings
- **ADB** - Direct Android device communication
- **JSON Data** - Package metadata and alternatives stored locally

## Features

- 📱 Connect to Android devices via USB or wireless ADB
- 🗑️ Uninstall, disable, restore, and enable system packages
- 📊 View package safety levels and descriptions
- 📜 Action history tracking with undo capability
- 💾 Create and restore package state backups
- 🔄 Open-source app alternatives suggestions
- ⚙️ Customizable settings

## Project Structure

```
frontend/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── adb/              # ADB command wrapper
│   │   ├── database/         # SQLite database module
│   │   ├── ipc/              # IPC handlers
│   │   └── services/         # Business logic services
│   ├── preload/              # Preload script (context bridge)
│   ├── renderer/             # React frontend
│   │   ├── components/       # UI components
│   │   ├── pages/            # Page components
│   │   └── store/            # Zustand state stores
│   └── data/                 # Static data files
│       └── debloat_lists.json
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- ADB installed and in PATH
- Android device with USB debugging enabled

### Installation

```bash
cd frontend
pnpm install
```

### Development

```bash
pnpm run dev
```

This will:

1. Compile TypeScript (main process)
2. Start Vite dev server (renderer)
3. Launch Electron

### Building

```bash
pnpm run build
pnpm run package:linux  # or package:win, package:mac
```

## Data Storage

All data is stored locally on your computer:

- **SQLite Database**: `~/.config/de-droid-frontend/dedroid.db`
  - Action history
  - Saved backups
  - User settings
- **Package Data**: Bundled JSON file with package metadata

## Debloat Data

The application includes a curated list of packages with:

- Safety levels (Recommended, Advanced, Expert, Unsafe)
- Categories (Bloatware, Optional, Essential)
- Descriptions and dependencies
- Open-source alternatives

You can extend this data by editing `src/data/debloat_lists.json`.

## Future: ML Package Classification

The Python backend (`backend-python/`) will be repurposed for:

- Training ML models to classify unknown packages
- Generating extended package metadata
- This data will be exported as JSON for the Electron app to consume

## License

MIT
