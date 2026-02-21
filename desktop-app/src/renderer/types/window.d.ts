import type { ElectronAPI } from "../../@types/preload.types";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
