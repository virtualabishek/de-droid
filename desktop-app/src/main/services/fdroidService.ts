/**
 * F-Droid Service — Handles downloading and installing apps from F-Droid.
 *
 * Process flow:
 * 1. Fetch APK URL from F-Droid API (tries multiple repos in order)
 * 2. Download APK to local system temp folder
 * 3. Install APK to Android device via ADB
 * 4. Clean up downloaded APK from system
 *
 * @module fdroidService
 */
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { app, BrowserWindow } from "electron";
import * as LocalAdb from "../adb";
import * as packageDataService from "./packageDataService";
import type { AlternativeApp } from "./packageDataService";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Known F-Droid repositories and their API / repo URLs. */
const FDROID_REPOS = [
  {
    name: "F-Droid Main",
    apiUrl: "https://f-droid.org/api/v1/packages",
    repoUrl: "https://f-droid.org/repo",
  },
  {
    name: "DivestOS",
    apiUrl: "https://divestos.org/apks/official/fdroid/repo",
    repoUrl: "https://divestos.org/apks/official/fdroid/repo",
    indexFile: "index-v1.json",
  },
  {
    name: "IzzyOnDroid",
    apiUrl: "https://apt.izzysoft.de/fdroid/api/v1/packages",
    repoUrl: "https://apt.izzysoft.de/fdroid/repo",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces (kept identical for backward-compat)
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  packageId: string;
  stage: "fetching" | "downloading" | "installing" | "success" | "error";
  progress: number; // 0-100
  downloadedMB?: number;
  totalMB?: number;
  speed?: string; // e.g. "1.5 MB/s"
  message: string;
}

export interface InstallResult {
  success: boolean;
  packageId: string;
  install_message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FdroidService class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches, downloads, and installs apps from the F-Droid ecosystem onto an
 * Android device via ADB.
 *
 * Typical usage — use the module-level backward-compat helpers (they delegate
 * to a shared singleton).  For isolated contexts create a fresh instance:
 *
 * ```typescript
 * const svc = new FdroidService();
 * const result = await svc.installFromFdroid(deviceId, packageId);
 * ```
 */
export class FdroidService {
  /** Local directory used to stage APK downloads before ADB push. */
  private readonly downloadDir: string;

  constructor() {
    this.downloadDir = path.join(app.getPath("userData"), "downloads");
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  private sendProgressToRenderer(progress: DownloadProgress): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send("fdroid:progress", progress);
    });
  }

  // ── Network helpers ────────────────────────────────────────────────────────

  /**
   * Fetches URL content as a raw string, following HTTP/HTTPS redirects.
   */
  private fetchUrl(url: string): Promise<{ statusCode: number; data: string }> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;

      protocol
        .get(url, (response) => {
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            this.fetchUrl(response.headers.location)
              .then(resolve)
              .catch(reject);
            return;
          }

          let data = "";
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => {
            resolve({ statusCode: response.statusCode || 0, data });
          });
        })
        .on("error", reject);
    });
  }

  /**
   * Downloads a file from `url` to `destPath` and emits real-time
   * `DownloadProgress` events to all open renderer windows.
   *
   * Follows redirects automatically.  Times out after 2 minutes.
   */
  private downloadFile(
    url: string,
    destPath: string,
    packageId: string,
  ): Promise<{ success: boolean; fileSize: number }> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;
      const startTime = Date.now();

      const request = protocol.get(url, (response) => {
        // Follow redirects
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          this.downloadFile(response.headers.location, destPath, packageId)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(
          response.headers["content-length"] || "0",
          10,
        );
        let downloadedSize = 0;
        let lastUpdate = Date.now();
        let lastDownloaded = 0;

        const fileStream = fs.createWriteStream(destPath);

        response.on("data", (chunk: Buffer) => {
          downloadedSize += chunk.length;

          const now = Date.now();
          const timeDiff = (now - lastUpdate) / 1000; // seconds

          if (timeDiff >= 0.1 || downloadedSize === totalSize) {
            const bytesPerSecond = (downloadedSize - lastDownloaded) / timeDiff;
            const speed = this.formatBytes(bytesPerSecond) + "/s";
            const progress =
              totalSize > 0
                ? Math.round((downloadedSize / totalSize) * 100)
                : 0;

            this.sendProgressToRenderer({
              packageId,
              stage: "downloading",
              progress,
              downloadedMB: downloadedSize / (1024 * 1024),
              totalMB: totalSize / (1024 * 1024),
              speed,
              message: `Downloading: ${this.formatBytes(downloadedSize)} / ${this.formatBytes(totalSize)} (${speed})`,
            });

            lastUpdate = now;
            lastDownloaded = downloadedSize;
          }
        });

        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[F-Droid] Download completed in ${totalTime}s`);
          resolve({ success: true, fileSize: downloadedSize });
        });

        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {}); // Remove partial file
          reject(err);
        });
      });

      request.on("error", (err) => {
        reject(err);
      });

      request.setTimeout(120000, () => {
        request.destroy();
        reject(new Error("Download timeout (2 minutes)"));
      });
    });
  }

  // ── Repository strategies ──────────────────────────────────────────────────

  /**
   * Attempts to resolve the APK URL via the main F-Droid REST API.
   * (`https://f-droid.org/api/v1/packages/{packageId}`)
   */
  private async tryMainFdroidApi(
    packageId: string,
  ): Promise<{ url: string; version: string; size: number } | null> {
    try {
      const { statusCode, data } = await this.fetchUrl(
        `https://f-droid.org/api/v1/packages/${packageId}`,
      );
      if (statusCode !== 200) return null;

      const packageInfo = JSON.parse(data);
      if (packageInfo.packages && packageInfo.packages.length > 0) {
        const latestVersion = packageInfo.packages[0];
        const versionCode = latestVersion.versionCode;
        const versionName = latestVersion.versionName || "unknown";

        // F-Droid API v1 omits apkName — construct it from the standard convention
        const apkName = `${packageId}_${versionCode}.apk`;
        console.log(`[F-Droid] Constructed APK name: ${apkName}`);

        return {
          url: `https://f-droid.org/repo/${apkName}`,
          version: versionName,
          size: latestVersion.size || 0,
        };
      }
    } catch (error) {
      console.log(`[F-Droid] Main API failed for ${packageId}:`, error);
    }
    return null;
  }

  /**
   * Attempts to resolve the APK URL via the IzzyOnDroid API.
   * (`https://apt.izzysoft.de/fdroid/api/v1/packages/{packageId}`)
   */
  private async tryIzzyOnDroidApi(
    packageId: string,
  ): Promise<{ url: string; version: string; size: number } | null> {
    try {
      const { statusCode, data } = await this.fetchUrl(
        `https://apt.izzysoft.de/fdroid/api/v1/packages/${packageId}`,
      );
      if (statusCode !== 200) return null;

      const packageInfo = JSON.parse(data);
      if (packageInfo.packages && packageInfo.packages.length > 0) {
        const latestVersion = packageInfo.packages[0];
        const versionCode = latestVersion.versionCode;
        const versionName = latestVersion.versionName || "unknown";
        const apkName = `${packageId}_${versionCode}.apk`;

        return {
          url: `https://apt.izzysoft.de/fdroid/repo/${apkName}`,
          version: versionName,
          size: latestVersion.size || 0,
        };
      }
    } catch (error) {
      console.log(`[F-Droid] IzzyOnDroid API failed for ${packageId}:`, error);
    }
    return null;
  }

  /**
   * Scrapes the F-Droid web page for APK download links.
   * Used as a fallback for packages hosted on third-party repos but listed
   * on `f-droid.org`.
   */
  private async tryScrapeFdroidPage(
    packageId: string,
  ): Promise<{ url: string; version: string; size: number } | null> {
    try {
      const pageUrl = `https://f-droid.org/en/packages/${packageId}/`;
      console.log(`[F-Droid] Scraping page: ${pageUrl}`);

      const { statusCode, data } = await this.fetchUrl(pageUrl);
      if (statusCode !== 200) return null;

      // Pattern 1: direct APK link from any repo
      const apkLinkMatch = data.match(/href="(https?:\/\/[^"]+\.apk)"/i);
      if (apkLinkMatch) {
        const apkUrl = apkLinkMatch[1];
        console.log(`[F-Droid] Found APK link: ${apkUrl}`);

        const versionMatch =
          data.match(/Version[:\s]+([0-9.]+)/i) || apkUrl.match(/_(\d+)\.apk$/);
        const version = versionMatch ? versionMatch[1] : "unknown";

        const sizeMatch = data.match(/(\d+(?:\.\d+)?)\s*(?:MB|MiB)/i);
        const size = sizeMatch ? parseFloat(sizeMatch[1]) * 1024 * 1024 : 0;

        return { url: apkUrl, version, size };
      }

      // Pattern 2: download button data attribute
      const downloadBtnMatch = data.match(/data-download-url="([^"]+)"/i);
      if (downloadBtnMatch) {
        return { url: downloadBtnMatch[1], version: "unknown", size: 0 };
      }
    } catch (error) {
      console.log(`[F-Droid] Page scraping failed for ${packageId}:`, error);
    }
    return null;
  }

  /**
   * Tries the DivestOS `index-v1.json` repository.
   * Only attempted for `us.spotco.*` packages (e.g. Mull browser).
   */
  private async tryDivestOSRepo(
    packageId: string,
  ): Promise<{ url: string; version: string; size: number } | null> {
    if (!packageId.startsWith("us.spotco")) return null;

    try {
      console.log(`[F-Droid] Trying DivestOS repo for ${packageId}`);
      const indexUrl =
        "https://divestos.org/apks/official/fdroid/repo/index-v1.json";

      const { statusCode, data } = await this.fetchUrl(indexUrl);
      if (statusCode !== 200) {
        console.log(`[F-Droid] DivestOS index returned ${statusCode}`);
        return null;
      }

      const index = JSON.parse(data);

      // index-v1.json: { apps: [...], packages: { "packageId": [...versions] } }
      if (index.packages && index.packages[packageId]) {
        const versions = index.packages[packageId];
        if (versions.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const latest = versions.reduce((a: any, b: any) =>
            a.versionCode > b.versionCode ? a : b,
          );
          const apkName =
            latest.apkName || `${packageId}_${latest.versionCode}.apk`;

          return {
            url: `https://divestos.org/apks/official/fdroid/repo/${apkName}`,
            version: latest.versionName || String(latest.versionCode),
            size: latest.size || 0,
          };
        }
      }
    } catch (error) {
      console.log(`[F-Droid] DivestOS repo failed for ${packageId}:`, error);
    }
    return null;
  }

  /**
   * Resolves the best available APK download info for `packageId`.
   *
   * Strategy order (first success wins):
   * 1. Main F-Droid API
   * 2. IzzyOnDroid API
   * 3. DivestOS repository index
   * 4. F-Droid web-page scrape (last resort)
   */
  private async getFdroidApkUrl(
    packageId: string,
  ): Promise<{ url: string; version: string; size: number } | null> {
    console.log(`[F-Droid] Looking for APK: ${packageId}`);

    let result = await this.tryMainFdroidApi(packageId);
    if (result) {
      console.log(`[F-Droid] Found in main repo: ${result.url}`);
      return result;
    }

    result = await this.tryIzzyOnDroidApi(packageId);
    if (result) {
      console.log(`[F-Droid] Found in IzzyOnDroid: ${result.url}`);
      return result;
    }

    result = await this.tryDivestOSRepo(packageId);
    if (result) {
      console.log(`[F-Droid] Found in DivestOS: ${result.url}`);
      return result;
    }

    result = await this.tryScrapeFdroidPage(packageId);
    if (result) {
      console.log(`[F-Droid] Found via page scrape: ${result.url}`);
      return result;
    }

    console.log(
      `[F-Droid] Could not find APK for ${packageId} in any repository`,
    );
    return null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Downloads an app from the F-Droid ecosystem and installs it on a device
   * via ADB.
   *
   * **Steps:**
   * 1. **Fetching** — resolve the APK download URL from F-Droid APIs.
   * 2. **Downloading** — stream the APK to the local temp folder with progress.
   * 3. **Installing** — push and install via `adb install`.
   * 4. **Cleanup** — remove the staged APK from disk.
   *
   * Real-time progress is broadcast to all open renderer windows on the
   * `"fdroid:progress"` IPC channel.
   *
   * @param deviceId      ADB device serial number.
   * @param packageId     Android package identifier to install.
   * @param alternativeId Optional alternative-app record ID — used only to
   *                      surface a manual-download URL in log output when the
   *                      automated download cannot find the APK.
   */
  async installFromFdroid(
    deviceId: string,
    packageId: string,
    alternativeId?: string,
  ): Promise<InstallResult> {
    try {
      // ── Step 1: Fetch APK URL ─────────────────────────────────────────────
      this.sendProgressToRenderer({
        packageId,
        stage: "fetching",
        progress: 0,
        message: "Fetching app info from F-Droid...",
      });

      const apkInfo = await this.getFdroidApkUrl(packageId);

      if (!apkInfo) {
        // Surface manual-download URL in logs if available
        const alt = alternativeId
          ? packageDataService.getAlternativeById(alternativeId)
          : packageDataService.getAlternativeByPackageId(packageId);

        if (alt?.sourceUrl) {
          console.log(
            `[F-Droid] Could not get APK URL for ${packageId}; ` +
              `manual download available at ${alt.sourceUrl}`,
          );
        }

        this.sendProgressToRenderer({
          packageId,
          stage: "error",
          progress: 0,
          message: "App not found on F-Droid. Try manual download.",
        });

        return {
          success: false,
          packageId,
          install_message: `Could not find APK download URL for ${packageId}. Please install manually from F-Droid.`,
        };
      }

      console.log(
        `[F-Droid] Found ${packageId} v${apkInfo.version} (${this.formatBytes(apkInfo.size)})`,
      );
      this.sendProgressToRenderer({
        packageId,
        stage: "fetching",
        progress: 100,
        message: `Found v${apkInfo.version} (${this.formatBytes(apkInfo.size)})`,
      });

      // ── Step 2: Download APK ──────────────────────────────────────────────
      const apkFileName = `${packageId.replace(/\./g, "_")}_${Date.now()}.apk`;
      const apkPath = path.join(this.downloadDir, apkFileName);

      console.log(`[F-Droid] Downloading from: ${apkInfo.url}`);
      console.log(`[F-Droid] Saving to: ${apkPath}`);

      this.sendProgressToRenderer({
        packageId,
        stage: "downloading",
        progress: 0,
        message: "Starting download...",
      });

      const downloadResult = await this.downloadFile(
        apkInfo.url,
        apkPath,
        packageId,
      );

      if (!downloadResult.success) {
        this.sendProgressToRenderer({
          packageId,
          stage: "error",
          progress: 0,
          message: "Download failed",
        });
        return {
          success: false,
          packageId,
          install_message: "Failed to download APK",
        };
      }

      // Verify the downloaded file is plausibly an APK
      const stats = fs.statSync(apkPath);
      if (stats.size < 1000) {
        fs.unlinkSync(apkPath);
        this.sendProgressToRenderer({
          packageId,
          stage: "error",
          progress: 0,
          message: "Downloaded file is corrupted",
        });
        return {
          success: false,
          packageId,
          install_message: "Downloaded file is too small, possibly corrupted",
        };
      }

      console.log(`[F-Droid] Downloaded APK: ${this.formatBytes(stats.size)}`);

      // ── Step 3: Install via ADB ───────────────────────────────────────────
      this.sendProgressToRenderer({
        packageId,
        stage: "installing",
        progress: 0,
        message: "Installing on device via ADB...",
      });

      console.log(`[F-Droid] Installing on device ${deviceId}...`);
      const installResult = await LocalAdb.installApk(deviceId, apkPath);

      // ── Step 4: Cleanup ───────────────────────────────────────────────────
      try {
        fs.unlinkSync(apkPath);
        console.log("[F-Droid] Cleaned up temp file");
      } catch (e) {
        console.warn("[F-Droid] Failed to clean up APK file:", e);
      }

      if (
        installResult.success &&
        !installResult.output.toLowerCase().includes("failure")
      ) {
        this.sendProgressToRenderer({
          packageId,
          stage: "success",
          progress: 100,
          message: "Installed successfully!",
        });
        return {
          success: true,
          packageId,
          install_message: `App installed successfully! (v${apkInfo.version})`,
        };
      } else {
        const errorMsg =
          installResult.error || installResult.output || "Installation failed";
        this.sendProgressToRenderer({
          packageId,
          stage: "error",
          progress: 0,
          message: errorMsg,
        });
        return {
          success: false,
          packageId,
          install_message: errorMsg,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[F-Droid] Error: ${errorMsg}`);

      this.sendProgressToRenderer({
        packageId,
        stage: "error",
        progress: 0,
        message: errorMsg,
      });

      return {
        success: false,
        packageId,
        install_message: errorMsg,
      };
    }
  }

  /**
   * Opens `url` in the operating system's default browser via the Electron
   * shell API.
   *
   * @param url  Fully-qualified URL to open.
   */
  openInBrowser(url: string): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { shell } = require("electron");
    shell.openExternal(url);
  }

  /**
   * Looks up download URLs for a package by searching a caller-supplied list
   * of {@link AlternativeApp} entries for a matching `packageId`.
   *
   * Returns `null` when no match is found, giving callers a clear signal to
   * fall back to a browser-based flow.
   *
   * @param packageId    Android package identifier to look up.
   * @param alternatives Pre-loaded array of alternative-app records to search.
   */
  getAppDownloadInfo(
    packageId: string,
    alternatives: AlternativeApp[],
  ): { fdroidUrl: string; githubUrl: string; packageId: string } | null {
    const alternative = alternatives.find((a) => a.packageId === packageId);
    if (!alternative) return null;

    return {
      fdroidUrl: alternative.sourceUrl || "",
      githubUrl: alternative.githubUrl || "",
      packageId: alternative.packageId || "",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible singleton + function exports
// (existing IPC handlers continue to work without any changes)
// ─────────────────────────────────────────────────────────────────────────────

let _fdroidInstance: FdroidService | null = null;

function getInstance(): FdroidService {
  if (!_fdroidInstance) _fdroidInstance = new FdroidService();
  return _fdroidInstance;
}

/**
 * Backward-compat wrapper.
 * @see {@link FdroidService.installFromFdroid}
 */
export async function installFromFdroid(
  deviceId: string,
  packageId: string,
): Promise<InstallResult> {
  return getInstance().installFromFdroid(deviceId, packageId);
}

/**
 * Backward-compat wrapper.
 * @see {@link FdroidService.openInBrowser}
 */
export function openInBrowser(url: string): void {
  return getInstance().openInBrowser(url);
}

/**
 * Backward-compat wrapper — accepts the `alternativeId` string used by the
 * existing IPC handler, resolves the {@link AlternativeApp} record via
 * `packageDataService`, then delegates to {@link FdroidService.getAppDownloadInfo}.
 *
 * Return fields are nullable to match the original function's type signature.
 */
export function getAppDownloadInfo(alternativeId: string): {
  fdroidUrl: string | null;
  githubUrl: string | null;
  packageId: string | null;
} {
  const alternative = packageDataService.getAlternativeById(alternativeId);
  if (!alternative) {
    return { fdroidUrl: null, githubUrl: null, packageId: null };
  }

  const result = getInstance().getAppDownloadInfo(alternative.packageId, [
    alternative,
  ]);

  if (!result) {
    return { fdroidUrl: null, githubUrl: null, packageId: null };
  }

  return {
    fdroidUrl: result.fdroidUrl || null,
    githubUrl: result.githubUrl || null,
    packageId: result.packageId || null,
  };
}
