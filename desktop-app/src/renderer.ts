import "./index.css";

declare global {
  interface Window {
    electronAPI: {
      adb: {
        isAvailable: () => Promise<boolean>;
        startAvailable: () => Promise<any>;
        stopAvailable: () => Promise<any>;
        getDevices: () => Promise<any[]>;
        getPackages: (deviceId: string, options?: any) => Promise<any[]>;
        disablePackage: (deviceId: string, packageName: string) => Promise<any>;
        enablePackage: (deviceId: string, packageName: string) => Promise<any>;
        uninstallPackage: (deviceId: string, packageName: string, keepData?: boolean) => Promise<any>;
        reinstallPackage: (deviceId: string, packageName: string) => Promise<any>;
        getDeviceInfo: (deviceId: string) => Promise<any>;
        isRooted: (deviceId: string) => Promise<boolean>;
      };
    };
  }
}

console.log(
  'Just testing if it works or not...',
);

document.addEventListener("DOMContentLoaded", async () => {
  if (window.electronAPI) {
    console.log("electronAPI is available!");
    console.log("Available methods:", Object.keys(window.electronAPI.adb));
  } else {
    console.error("electronAPI is NOT available!");
    return;
  }

  try {
    const adbAvailable = await window.electronAPI.adb.isAvailable();
    console.log("ADB Available:", adbAvailable);
  } catch (error) {
    console.error("Failed to check ADB availability:", error);
  }

  const getDevicesBtn = document.getElementById("get-devices");
  const startServerBtn = document.getElementById("start-server");
  const stopServerBtn = document.getElementById("stop-server");
  const output = document.getElementById("output");

  if (getDevicesBtn) {
    getDevicesBtn.addEventListener("click", async () => {
      console.log("[Renderer] Get Devices button clicked");
      if (output) {
        output.innerHTML = `<pre>Loading devices...</pre>`;
      }
      try {
        console.log("[Renderer] Calling electronAPI.adb.getDevices()");
        const devices = await window.electronAPI.adb.getDevices();
        console.log("[Renderer] Received devices:", devices);
        
        if (output) {
          if (devices.length === 0) {
            output.innerHTML = `<pre style="color: orange;">No devices found\n\nMake sure:\n1. Device is connected via USB\n2. USB debugging is enabled\n3. Device is authorized</pre>`;
          } else {
            output.innerHTML = `<pre style="color: green;">Found ${devices.length} device(s):\n\n${JSON.stringify(devices, null, 2)}</pre>`;
          }
        }
      } catch (error) {
        console.error("[Renderer] Error getting devices:", error);
        if (output) {
          output.innerHTML = `<pre style="color: red;">Error: ${error}</pre>`;
        }
      }
    });
  }

  if (startServerBtn) {
    console.log("Attaching click handler to Start Server button");
    startServerBtn.addEventListener("click", async () => {
      if (output) {
        output.innerHTML = `<pre>Starting ADB server...</pre>`;
      }
      try {
        console.log("Calling window.electronAPI.adb.startAvailable()...");
        const result = await window.electronAPI.adb.startAvailable();
        console.log("Server start result:", result);
        if (output) {
          if (result.success) {
            output.innerHTML = `<pre style="color: green;">ADB Server Started\n\n${JSON.stringify(result, null, 2)}</pre>`;
          } else {
            output.innerHTML = `<pre style="color: orange;">Server start result:\n\n${JSON.stringify(result, null, 2)}</pre>`;
          }
        }
      } catch (error) {
        console.error("Error starting server:", error);
        if (output) {
          output.innerHTML = `<pre style="color: red;">Error: ${error}</pre>`;
        }
      }
    });
    console.log("Start Server button event listener attached successfully");
  } else {
    console.error("Start Server button not found!");
  }

  if (stopServerBtn) {
    stopServerBtn.addEventListener("click", async () => {
      try {
        const result = await window.electronAPI.adb.stopAvailable();
        if (output) {
          output.innerHTML = `<pre>${JSON.stringify(result, null, 2)}</pre>`;
        }
        console.log("ADB Server Stopped:", result);
      } catch (error) {
        console.error("Error stopping server:", error);
        if (output) {
          output.innerHTML = `<pre>Error: ${error}</pre>`;
        }
      }
    });
  }
});