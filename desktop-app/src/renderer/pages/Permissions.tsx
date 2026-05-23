/**
 * Permissions Page - Standalone page for managing app permissions
 */
import { useState } from "react";
import { PermissionDashboard } from "../components/PermissionDashboard";
import { PermissionManager } from "../components/PermissionManager";
import { useDeviceStore } from "../store/deviceStore";
import { DeviceSelector } from "../components/DeviceSelector";
import { permissionAnalyticsService } from "../services/permissionService";

export default function Permissions() {
  const { selectedDevice } = useDeviceStore();
  const [permissionPackage, setPermissionPackage] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <header className="bg-gradient-to-r from-gray-800 via-gray-800 to-primary-900/30 border-b border-gray-700/50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-gray-100 to-primary-300 bg-clip-text text-transparent">
              Permissions
            </h1>
            <p className="text-gray-400 mt-1 flex items-center gap-2">
              <span>Analyze and manage app permissions on your device</span>
              {selectedDevice && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                  Connected
                </span>
              )}
            </p>
          </div>

          {selectedDevice && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-semibold">{selectedDevice.model}</p>
                <p className="text-sm text-gray-400">{selectedDevice.brand}</p>
              </div>
              <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        {/* Device Selector Sidebar */}
        <div className="w-80 flex-shrink-0">
          <DeviceSelector />
          
          {/* Quick Tips */}
          {selectedDevice && (
            <div className="mt-4 bg-gray-800 rounded-xl border border-gray-700 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Quick Tips
              </h3>
              <ul className="space-y-2 text-xs text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-green-400">•</span>
                  <span>Scan all apps to see their permission usage</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-yellow-400">•</span>
                  <span>Only runtime permissions can be revoked via ADB</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400">•</span>
                  <span>Revoking permissions may affect app functionality</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400">•</span>
                  <span>Lower privacy scores indicate more invasive apps</span>
                </li>
              </ul>
            </div>
          )}

          {/* Permission Categories Legend */}
          {selectedDevice && (
            <div className="mt-4 bg-gray-800 rounded-xl border border-gray-700 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                Privacy Categories
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(["Location", "Camera", "Microphone", "Contacts", "Phone", "SMS", "Storage", "Calendar"] as const).map((category) => {
                  const config = permissionAnalyticsService.getCategoryConfig(category);

                  return (
                    <div key={category} className="flex items-center gap-1.5">
                      <span>{config.icon}</span>
                      <span className="text-gray-400">{category}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Permission Dashboard */}
        <div className="flex-1 overflow-hidden">
          {selectedDevice ? (
            <PermissionDashboard
              onOpenAppPermissions={(pkg) => setPermissionPackage(pkg)}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-800 rounded-xl border border-gray-700">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 mx-auto mb-6 bg-primary-600/10 rounded-3xl flex items-center justify-center border border-primary-500/30">
                  <svg className="w-12 h-12 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">
                  Permission Manager
                </h3>
                <p className="text-gray-400 mb-6">
                  Connect an Android device to scan and manage app permissions. 
                  Identify privacy-invasive apps and revoke unnecessary permissions.
                </p>
                <div className="flex flex-wrap gap-2 justify-center text-sm">
                  <span className="px-3 py-1.5 bg-primary-500/20 text-primary-300 rounded-full border border-primary-500/30">
                    Privacy Analysis
                  </span>
                  <span className="px-3 py-1.5 bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30">
                    Bulk Revoke
                  </span>
                  <span className="px-3 py-1.5 bg-green-500/20 text-green-300 rounded-full border border-green-500/30">
                    Category View
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Permission Manager Modal */}
      {permissionPackage && (
        <PermissionManager
          packageName={permissionPackage}
          onClose={() => setPermissionPackage(null)}
        />
      )}
    </div>
  );
}
