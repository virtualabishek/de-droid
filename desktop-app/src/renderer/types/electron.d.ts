import type { ElectronAPI } from "../../shared/electron-api";

export * from "../../shared/electron-api";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
