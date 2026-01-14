import { execSync, ChildProcess, spawn } from "child_process";
import { getAdbPath } from "./adb-path";
import { AdbCommandResult, AdbDevice, PackageInfo } from "src/@types/adb.types";

export class AdbManager {
  private adbPath: string;
  private adbServer: ChildProcess | null = null;
  constructor() {
    this.adbPath = getAdbPath();
    console.log("[ADB Manager] Initialized with path:", this.adbPath);
  }

  private executeSync(args: string[]): AdbCommandResult {
    const command = `"${this.adbPath}" ${args.join(" ")}`;
    console.log("[ADB Manager] Executing command:", command);
    try {
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: 30000,
      });
      console.log(
        "[ADB Manager] Command success. Output length:",
        output.length
      );
      return { success: true, output: output.trim() };
    } catch (error: any) {
      console.error("[ADB Manager] Command failed:", error.message);
      return {
        success: false,
        output: "",
        error: error.message || "ADB command failed",
      };
    }
  }

  private execute(args: string[]): Promise<AdbCommandResult> {
    console.log(
      "[ADB Manager] Spawning command:",
      this.adbPath,
      args.join(" ")
    );
    return new Promise((resolve) => {
      const proc = spawn(this.adbPath, args);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({
            success: false,
            output: stdout.trim(),
            error: stderr.trim(),
          });
        }
      });
      proc.on("error", (error) => {
        resolve({ success: false, output: "", error: error.message });
      });
    });
  }
  async startServer(): Promise<AdbCommandResult> {
    return this.execute(["start-server"]);
  }
  async stopServer(): Promise<AdbCommandResult> {
    return this.execute(["kill-server"]);
  }
  async getDevices(): Promise<AdbDevice[]> {
    const result = await this.execute(["devices", "-l"]);
    if (!result.success) return [];
    const devices: AdbDevice[] = [];
    const lines = result.output.split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const device: AdbDevice = {
        id: parts[0],
        status: parts[1] as AdbDevice["status"],
      };

      for (const part of parts.slice(2)) {
        if (part.startsWith("model:")) {
          device.model = part.split(":")[1];
        } else if (part.startsWith("product:")) {
          device.product = part.split(":")[1];
        } else if (part.startsWith("transport_id:")) {
          device.transportId = part.split(":")[1];
        }
      }
      devices.push(device);
    }
    return devices;
  }

  async getPackages(
    deviceId: string,
    options: {
      systemOnly?: boolean;
      thirdPartyOnly?: boolean;
      disabled?: boolean;
    } = {}
  ): Promise<PackageInfo[]> {
    const args = ["-s", deviceId, "shell", "pm", "list", "packages"];

    if (options.systemOnly) args.push("-s");
    if (options.thirdPartyOnly) args.push("-3");
    if (options.disabled) args.push("-d");

    const result = await this.execute(args);
    console.log("[ADB Manager] getPackages result:", JSON.stringify(result));
    if (!result.success) return [];

    const packages: PackageInfo[] = [];
    const lines = result.output.split("\n");
    console.log("[ADB Manager] Number of lines:", lines.length);
    console.log("[ADB Manager] First 3 lines:", lines.slice(0, 3));

    for (const line of lines) {
      const match = line.trim().match(/^package:(.+)$/);
      if (match) {
        packages.push({
          packageName: match[1].trim(),
          isSystemApp: options.systemOnly ?? false,
          isDisabled: options.disabled ?? false,
        });
      }
    }

    return packages;
  }

  async disablePackage(
    deviceId: string,
    packageName: string
  ): Promise<AdbCommandResult> {
    return this.execute([
      "-s",
      deviceId,
      "shell",
      "pm",
      "disable-user",
      "--user",
      "0",
      packageName,
    ]);
  }

  async enablePackage(
    deviceId: string,
    packageName: string
  ): Promise<AdbCommandResult> {
    return this.execute(["-s", deviceId, "shell", "pm", "enable", packageName]);
  }

  async uninstallPackage(
    deviceId: string,
    packageName: string,
    keepData: boolean = true
  ): Promise<AdbCommandResult> {
    const args = ["-s", deviceId, "shell", "pm", "uninstall"];
    if (keepData) args.push("-k");
    args.push("--user", "0", packageName);
    return this.execute(args);
  }

  async reinstallPackage(
    deviceId: string,
    packageName: string
  ): Promise<AdbCommandResult> {
    return this.execute([
      "-s",
      deviceId,
      "shell",
      "cmd",
      "package",
      "install-existing",
      packageName,
    ]);
  }

  async getDeviceInfo(deviceId: string): Promise<Record<string, string>> {
    const props = [
      "ro.product.model",
      "ro.product.brand",
      "ro.build.version.release",
      "ro.product.device",
    ];
    const info: Record<string, string> = {};

    for (const prop of props) {
      const result = await this.execute([
        "-s",
        deviceId,
        "shell",
        "getprop",
        prop,
      ]);
      if (result.success) {
        info[prop] = result.output;
      }
    }

    return info;
  }

  // Check if device is rooted
  async isRooted(deviceId: string): Promise<boolean> {
    const result = await this.execute([
      "-s",
      deviceId,
      "shell",
      "su",
      "-c",
      "echo",
      "root",
    ]);
    return result.success && result.output.includes("root");
  }
}

let adbManagerInstance: AdbManager | null = null;

export function getAdbManager(): AdbManager {
  if (!adbManagerInstance) {
    adbManagerInstance = new AdbManager();
  }
  return adbManagerInstance;
}
