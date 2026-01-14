export interface AdbDevice {
    id: string;
    status: 'device' | 'offline' | 'unauthorized' | 'no permissions';
    model?: string;
    product?: string;
    transportId?: string;
}
export interface PackageInfo {
    packageName: string;
    isSystemApp: boolean;
    isDisabled: boolean;
    versionName?: string;
}
export interface AdbCommandResult {
    success: boolean;
    output: string;
    error?: string;
}
//# sourceMappingURL=adb.types.d.ts.map