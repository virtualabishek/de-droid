import type { ElectronAPI } from "../../@types/electron-api";

export * from "../../@types/electron-api";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
