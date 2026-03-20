/**
 * F-Droid Service - Handles downloading and installing apps from F-Droid
 * 
 * Process Flow:
 * 1. Fetch APK URL from F-Droid API (tries multiple repos)
 * 2. Download APK to local system (temp folder)
 * 3. Install APK to Android device via ADB
 * 4. Clean up downloaded APK from system
 */
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { app, BrowserWindow } from "electron";
import * as LocalAdb from "../adb";
import * as packageDataService from "./packageDataService";

// Download directory for APKs
const DOWNLOAD_DIR = path.join(app.getPath("userData"), "downloads");

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Known F-Droid repositories and their API/repo URLs
const FDROID_REPOS = [
  {
    name: "F-Droid Main",
    apiUrl: "https://f-droid.org/api/v1/packages",
    repoUrl: "https://f-droid.org/repo",
  },
  {
    name: "DivestOS",
    apiUrl: "https://divestos.org/apks/official/fdroid/repo", // DivestOS uses index-v1.json
    repoUrl: "https://divestos.org/apks/official/fdroid/repo",
    indexFile: "index-v1.json",
  },
  {
    name: "IzzyOnDroid",
    apiUrl: "https://apt.izzysoft.de/fdroid/api/v1/packages",
    repoUrl: "https://apt.izzysoft.de/fdroid/repo",
  },
];

export interface DownloadProgress {
  packageId: string;
  stage: "fetching" | "downloading" | "installing" | "success" | "error";
  progress: number; // 0-100
  downloadedMB?: number;
  totalMB?: number;
  speed?: string; // e.g., "1.5 MB/s"
  message: string;
}

export interface InstallResult {
  success: boolean;
  packageId: string;
  install_message: string;
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

/**
 * Send progress update to renderer
 */
function sendProgressToRenderer(progress: DownloadProgress): void {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send("fdroid:progress", progress);
  });
}

/**
 * Download a file from URL with detailed progress
 */
async function downloadFile(
  url: string,
  destPath: string,
  packageId: string
): Promise<{ success: boolean; fileSize: number }> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const startTime = Date.now();
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadFile(response.headers.location, destPath, packageId)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers["content-length"] || "0", 10);
      let downloadedSize = 0;
      let lastUpdate = Date.now();
      let lastDownloaded = 0;

      const fileStream = fs.createWriteStream(destPath);

      response.on("data", (chunk: Buffer) => {
        downloadedSize += chunk.length;
        
        const now = Date.now();
        const timeDiff = (now - lastUpdate) / 1000; // seconds
        
        // Update progress every 100ms or when significant progress is made
        if (timeDiff >= 0.1 || downloadedSize === totalSize) {
          const bytesPerSecond = (downloadedSize - lastDownloaded) / timeDiff;
          const speed = formatBytes(bytesPerSecond) + "/s";
          const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
          
          sendProgressToRenderer({
            packageId,
            stage: "downloading",
            progress,
            downloadedMB: downloadedSize / (1024 * 1024),
            totalMB: totalSize / (1024 * 1024),
            speed,
            message: `Downloading: ${formatBytes(downloadedSize)} / ${formatBytes(totalSize)} (${speed})`,
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
        fs.unlink(destPath, () => {}); // Delete partial file
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

/**
 * Fetch URL content as string
 */
function fetchUrl(url: string): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    
    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchUrl(response.headers.location).then(resolve).catch(reject);
        return;
      }
      
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode || 0, data });
      });
    }).on("error", reject);
  });
}

/**
 * Try to get APK URL from main F-Droid API
 */
async function tryMainFdroidApi(packageId: string): Promise<{ url: string; version: string; size: number } | null> {
  try {
    const { statusCode, data } = await fetchUrl(`https://f-droid.org/api/v1/packages/${packageId}`);
    
    if (statusCode !== 200) {
      return null;
    }
    
    const packageInfo = JSON.parse(data);
    if (packageInfo.packages && packageInfo.packages.length > 0) {
      const latestVersion = packageInfo.packages[0];
      const versionCode = latestVersion.versionCode;
      const versionName = latestVersion.versionName || "unknown";
      
      // F-Droid API v1 doesn't include apkName - construct it from packageId and versionCode
      // Standard naming convention: {packageId}_{versionCode}.apk
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
 * Try to get APK URL from IzzyOnDroid repository
 */
async function tryIzzyOnDroidApi(packageId: string): Promise<{ url: string; version: string; size: number } | null> {
  try {
    const { statusCode, data } = await fetchUrl(`https://apt.izzysoft.de/fdroid/api/v1/packages/${packageId}`);
    
    if (statusCode !== 200) {
      return null;
    }
    
    const packageInfo = JSON.parse(data);
    if (packageInfo.packages && packageInfo.packages.length > 0) {
      const latestVersion = packageInfo.packages[0];
      const versionCode = latestVersion.versionCode;
      const versionName = latestVersion.versionName || "unknown";
      
      // Construct APK name from packageId and versionCode
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
 * Try to scrape the F-Droid web page for download links
 * This works for packages hosted on third-party repos that are listed on f-droid.org
 */
async function tryScrapeFdroidPage(packageId: string): Promise<{ url: string; version: string; size: number } | null> {
  try {
    const pageUrl = `https://f-droid.org/en/packages/${packageId}/`;
    console.log(`[F-Droid] Scraping page: ${pageUrl}`);
    
    const { statusCode, data } = await fetchUrl(pageUrl);
    
    if (statusCode !== 200) {
      return null;
    }
    
    // Look for APK download link in the page
    // F-Droid pages have links like: href="https://f-droid.org/repo/package_version.apk"
    // Or for third-party repos: href="https://divestos.org/apks/official/fdroid/repo/us.spotco.fennec_dos_123456.apk"
    
    // Pattern 1: Direct APK link from any repo
    const apkLinkMatch = data.match(/href="(https?:\/\/[^"]+\.apk)"/i);
    if (apkLinkMatch) {
      const apkUrl = apkLinkMatch[1];
      console.log(`[F-Droid] Found APK link: ${apkUrl}`);
      
      // Try to extract version from URL or page
      const versionMatch = data.match(/Version[:\s]+([0-9.]+)/i) || 
                          apkUrl.match(/_(\d+)\.apk$/);
      const version = versionMatch ? versionMatch[1] : "unknown";
      
      // Try to get size from page
      const sizeMatch = data.match(/(\d+(?:\.\d+)?)\s*(?:MB|MiB)/i);
      const size = sizeMatch ? parseFloat(sizeMatch[1]) * 1024 * 1024 : 0;
      
      return { url: apkUrl, version, size };
    }
    
    // Pattern 2: Look for download button data attributes
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
 * Try DivestOS repository index
 * DivestOS hosts apps like Mull browser
 */
async function tryDivestOSRepo(packageId: string): Promise<{ url: string; version: string; size: number } | null> {
  // Known DivestOS packages
  const divestOsPackages = [
    "us.spotco.fennec_dos", // Mull browser
    "us.spotco.mulch",      // Mulch browser
    "us.spotco.seedvault",  // Seedvault backup
  ];
  
  if (!divestOsPackages.some(pkg => packageId.startsWith(pkg.split('.').slice(0, 2).join('.')))) {
    // Quick check - if package doesn't look like a DivestOS package, skip
    if (!packageId.startsWith("us.spotco")) {
      return null;
    }
  }
  
  try {
    console.log(`[F-Droid] Trying DivestOS repo for ${packageId}`);
    const indexUrl = "https://divestos.org/apks/official/fdroid/repo/index-v1.json";
    
    const { statusCode, data } = await fetchUrl(indexUrl);
    
    if (statusCode !== 200) {
      console.log(`[F-Droid] DivestOS index returned ${statusCode}`);
      return null;
    }
    
    const index = JSON.parse(data);
    
    // index-v1.json structure: { apps: [...], packages: { "packageId": [...versions] } }
    if (index.packages && index.packages[packageId]) {
      const versions = index.packages[packageId];
      if (versions.length > 0) {
        // Get the latest version (highest versionCode)
        const latest = versions.reduce((a: any, b: any) => 
          (a.versionCode > b.versionCode) ? a : b
        );
        
        const apkName = latest.apkName || `${packageId}_${latest.versionCode}.apk`;
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
 * Get F-Droid APK download URL for a package
 * Tries multiple sources in order:
 * 1. Main F-Droid API
 * 2. IzzyOnDroid API
 * 3. DivestOS repository
 * 4. Scrape F-Droid web page (fallback)
 */
async function getFdroidApkUrl(packageId: string): Promise<{ url: string; version: string; size: number } | null> {
  console.log(`[F-Droid] Looking for APK: ${packageId}`);
  
  // Try main F-Droid API first
  let result = await tryMainFdroidApi(packageId);
  if (result) {
    console.log(`[F-Droid] Found in main repo: ${result.url}`);
    return result;
  }
  
  // Try IzzyOnDroid
  result = await tryIzzyOnDroidApi(packageId);
  if (result) {
    console.log(`[F-Droid] Found in IzzyOnDroid: ${result.url}`);
    return result;
  }
  
  // Try DivestOS repo (for us.spotco.* packages)
  result = await tryDivestOSRepo(packageId);
  if (result) {
    console.log(`[F-Droid] Found in DivestOS: ${result.url}`);
    return result;
  }
  
  // Fallback: try scraping the F-Droid page
  result = await tryScrapeFdroidPage(packageId);
  if (result) {
    console.log(`[F-Droid] Found via page scrape: ${result.url}`);
    return result;
  }
  
  console.log(`[F-Droid] Could not find APK for ${packageId} in any repository`);
  return null;
}

/**
 * Install an app from F-Droid
 * 
 * Steps:
 * 1. Fetching: Get APK download URL from F-Droid API
 * 2. Downloading: Download APK to local temp folder
 * 3. Installing: Push APK to device and install via ADB
 * 4. Cleanup: Remove downloaded APK from system
 */
export async function installFromFdroid(
  deviceId: string,
  packageId: string
): Promise<InstallResult> {
  try {
    // Step 1: Fetching APK URL
    sendProgressToRenderer({
      packageId,
      stage: "fetching",
      progress: 0,
      message: "Fetching app info from F-Droid...",
    });

    const apkInfo = await getFdroidApkUrl(packageId);

    if (!apkInfo) {
      // Try alternative: check if package exists in our local data
      const alternative = packageDataService.getAlternativeByPackageId(packageId);
      if (alternative?.sourceUrl) {
        console.log(`Could not get APK URL from API for ${packageId}`);
      }
      
      sendProgressToRenderer({
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

    console.log(`[F-Droid] Found ${packageId} v${apkInfo.version} (${formatBytes(apkInfo.size)})`);
    
    sendProgressToRenderer({
      packageId,
      stage: "fetching",
      progress: 100,
      message: `Found v${apkInfo.version} (${formatBytes(apkInfo.size)})`,
    });

    // Step 2: Download APK to system
    const apkFileName = `${packageId.replace(/\./g, "_")}_${Date.now()}.apk`;
    const apkPath = path.join(DOWNLOAD_DIR, apkFileName);

    console.log(`[F-Droid] Downloading from: ${apkInfo.url}`);
    console.log(`[F-Droid] Saving to: ${apkPath}`);

    sendProgressToRenderer({
      packageId,
      stage: "downloading",
      progress: 0,
      message: "Starting download...",
    });

    const downloadResult = await downloadFile(apkInfo.url, apkPath, packageId);

    if (!downloadResult.success) {
      sendProgressToRenderer({
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

    // Verify file
    const stats = fs.statSync(apkPath);
    if (stats.size < 1000) {
      fs.unlinkSync(apkPath);
      sendProgressToRenderer({
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

    console.log(`[F-Droid] Downloaded APK: ${formatBytes(stats.size)}`);

    // Step 3: Install via ADB
    sendProgressToRenderer({
      packageId,
      stage: "installing",
      progress: 0,
      message: "Installing on device via ADB...",
    });

    console.log(`[F-Droid] Installing on device ${deviceId}...`);
    const installResult = await LocalAdb.installApk(deviceId, apkPath);

    // Step 4: Cleanup
    try {
      fs.unlinkSync(apkPath);
      console.log(`[F-Droid] Cleaned up temp file`);
    } catch (e) {
      console.warn("Failed to clean up APK file:", e);
    }

    // Check result
    if (installResult.success && !installResult.output.toLowerCase().includes("failure")) {
      sendProgressToRenderer({
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
      const errorMsg = installResult.error || installResult.output || "Installation failed";
      sendProgressToRenderer({
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
    
    sendProgressToRenderer({
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
 * Open a URL in the system browser
 */
export function openInBrowser(url: string): void {
  const { shell } = require("electron");
  shell.openExternal(url);
}

/**
 * Get all download URLs for an alternative app
 */
export function getAppDownloadInfo(alternativeId: string): {
  fdroidUrl: string | null;
  githubUrl: string | null;
  packageId: string | null;
} {
  const alternative = packageDataService.getAlternativeById(alternativeId);

  if (!alternative) {
    return {
      fdroidUrl: null,
      githubUrl: null,
      packageId: null,
    };
  }

  return {
    fdroidUrl: alternative.sourceUrl || null,
    githubUrl: alternative.githubUrl || null,
    packageId: alternative.packageId || null,
  };
}
