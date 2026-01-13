import { app } from "electron"
import path from "path"
import fs from 'fs';
import { execSync } from "child_process";


export function getAdbPath(): string {
    const platform = process.platform;
    const isDev =! app.isPackaged;
    const basePath = isDev ?  path.join(__dirname, '..', '..', '..', 'resources', 'adb') : path.join(process.resourcesPath, 'adb');
    let adbPath: string;
    switch(platform) {
        case 'win32':
            adbPath =   path.join(basePath, 'win', 'adb.exe');
            break;
        case 'darwin':
            adbPath = path.join(basePath, 'mac', 'adb');
            break;
        case 'linux':
        default:
            adbPath = path.join(basePath, 'linux', 'adb');
            break;
    }
    if(fs.existsSync(adbPath)) {
        if(platform !== 'win32') {
            try {
                fs.chmodSync(adbPath, '755');
            } catch(e) {
                console.warn("Could not set ADB executable permission.", e)
            }
        }
        return adbPath;
    } 
    try {
        const systemAdb = execSync('which adb || where adb', { encoding: 'utf-8' }).trim();
        if(systemAdb) {
            console.log('Using system adb: ', systemAdb);
            return systemAdb.split('\n')[0];
        }
    } catch(e) {
        console.warn("Adb not found in the path")
    }
    throw new Error(`ADB not found. Expected at: ${adbPath}`)

}


export function isAdbAvailable(): boolean {
    try {
        getAdbPath();
        return true;
    } catch {
        return false;
    }
}