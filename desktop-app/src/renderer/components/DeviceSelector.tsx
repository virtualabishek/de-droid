import { useEffect, useState } from 'react';
import { useDeviceStore } from '../store/deviceStore';

export function DeviceSelector() {
  const {
    devices,
    selectedDevice,
    selectedUser,
    isLoadingDevices,
    fetchDevices,
    selectDevice,
    selectUser,
  } = useDeviceStore();

  const [showWirelessPanel, setShowWirelessPanel] = useState(false);
  const [wirelessMode, setWirelessMode] = useState<'connect' | 'pair' | 'qr'>('connect');
  const [wirelessIp, setWirelessIp] = useState('');
  const [wirelessPort, setWirelessPort] = useState('5555');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingPort, setPairingPort] = useState('');
  const [qrData, setQrData] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [wirelessError, setWirelessError] = useState<string | null>(null);
  const [wirelessSuccess, setWirelessSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchDevices();
    // Poll for device changes
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  // Parse QR code data format: WIFI:T:ADB;S:hostname;P:port;;PAIRING:code;
  const parseQrCode = (data: string) => {
    try {
      // Common format: WIFI:T:ADB;S:adb-XXXX._adb-tls-pairing._tcp.;P:port;;
      // Or simpler: IP:PORT:CODE
      
      // Try simple format first (IP:PORT:CODE)
      const simpleParts = data.split(':');
      if (simpleParts.length === 3) {
        return {
          ip: simpleParts[0],
          port: simpleParts[1],
          code: simpleParts[2],
        };
      }
      
      // Try to parse Android's QR format
      const ipMatch = data.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      const portMatch = data.match(/P:(\d+)/);
      const codeMatch = data.match(/PAIRING:(\d+)/);
      
      if (ipMatch && portMatch) {
        return {
          ip: ipMatch[1],
          port: portMatch[1],
          code: codeMatch ? codeMatch[1] : '',
        };
      }
      
      return null;
    } catch {
      return null;
    }
  };

  const handleQrParse = () => {
    if (!qrData.trim()) {
      setWirelessError('Please paste the QR code data');
      return;
    }

    const parsed = parseQrCode(qrData.trim());
    if (parsed) {
      setWirelessIp(parsed.ip);
      setPairingPort(parsed.port);
      if (parsed.code) {
        setPairingCode(parsed.code);
      }
      setWirelessSuccess('QR data parsed! Fill in the pairing code if needed.');
      setWirelessMode('pair');
      setQrData('');
    } else {
      setWirelessError('Could not parse QR code data. Try manual entry.');
    }
  };

  const handleWirelessConnect = async () => {
    if (!wirelessIp) {
      setWirelessError('Please enter an IP address');
      return;
    }

    setIsConnecting(true);
    setWirelessError(null);
    setWirelessSuccess(null);

    try {
      const result = await window.electronAPI.adb.wireless.connect(
        wirelessIp,
        parseInt(wirelessPort) || 5555
      );
      if (result.success) {
        setWirelessSuccess('Connected successfully!');
        await fetchDevices();
        setWirelessIp('');
        setWirelessPort('5555');
        setTimeout(() => setShowWirelessPanel(false), 1500);
      } else {
        setWirelessError(result.message || 'Connection failed');
      }
    } catch (err) {
      setWirelessError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWirelessPair = async () => {
    if (!wirelessIp || !pairingPort || !pairingCode) {
      setWirelessError('Please fill in all pairing fields');
      return;
    }

    setIsConnecting(true);
    setWirelessError(null);
    setWirelessSuccess(null);

    try {
      const result = await window.electronAPI.adb.wireless.pair(
        wirelessIp,
        parseInt(pairingPort),
        pairingCode
      );
      if (result.success) {
        setWirelessSuccess('Paired successfully! Now connect to the device.');
        setWirelessMode('connect');
        setPairingCode('');
        setPairingPort('');
      } else {
        setWirelessError(result.message || 'Pairing failed');
      }
    } catch (err) {
      setWirelessError(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-400">Connected Devices</h3>
        <button
          onClick={() => fetchDevices()}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
          title="Refresh devices"
        >
          <svg className={`w-4 h-4 text-gray-400 ${isLoadingDevices ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {isLoadingDevices && devices.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      ) : devices.length === 0 ? (
        <div className="text-center py-6">
          <svg
            className="w-12 h-12 mx-auto text-gray-600 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <p className="text-gray-400 text-sm">No devices connected</p>
          <p className="text-xs text-gray-500 mt-1">
            Connect via USB or wirelessly
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {devices.map((device) => (
            <button
              key={device.adb_id}
              onClick={() => selectDevice(device)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                selectedDevice?.adb_id === device.adb_id
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                selectedDevice?.adb_id === device.adb_id ? 'bg-primary-700' : 'bg-gray-600'
              }`}>
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium">{device.model}</p>
                <p className="text-xs opacity-70">
                  {device.brand} • SDK {device.android_sdk}
                  {device.adb_id.includes(':') && ' • Wireless'}
                </p>
              </div>
              {selectedDevice?.adb_id === device.adb_id && (
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Wireless ADB Button */}
      <button
        onClick={() => setShowWirelessPanel(!showWirelessPanel)}
        className={`w-full mt-3 flex items-center justify-center gap-2 p-3 rounded-lg transition-colors ${
          showWirelessPanel 
            ? 'bg-primary-600 text-white' 
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
        </svg>
        <span className="text-sm font-medium">Wireless ADB</span>
      </button>

      {/* Wireless ADB Panel */}
      {showWirelessPanel && (
        <div className="mt-3 p-4 bg-gray-700/50 rounded-lg border border-gray-600">
          {/* Mode Tabs */}
          <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setWirelessMode('connect')}
              className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                wirelessMode === 'connect'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              🔌 Connect
            </button>
            <button
              onClick={() => setWirelessMode('pair')}
              className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                wirelessMode === 'pair'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              🔗 Pair
            </button>
            <button
              onClick={() => setWirelessMode('qr')}
              className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                wirelessMode === 'qr'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              📱 QR Code
            </button>
          </div>

          {/* Error/Success Messages */}
          {wirelessError && (
            <div className="mb-3 p-2 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-xs">
              {wirelessError}
            </div>
          )}
          {wirelessSuccess && (
            <div className="mb-3 p-2 bg-green-500/20 border border-green-500/30 rounded text-green-400 text-xs">
              {wirelessSuccess}
            </div>
          )}

          {wirelessMode === 'connect' ? (
            <>
              <p className="text-xs text-gray-400 mb-3">
                Connect to a device that's already paired or has TCP/IP enabled
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="IP Address (e.g., 192.168.1.100)"
                  value={wirelessIp}
                  onChange={(e) => setWirelessIp(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500"
                />
                <input
                  type="text"
                  placeholder="Port (default: 5555)"
                  value={wirelessPort}
                  onChange={(e) => setWirelessPort(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500"
                />
                <button
                  onClick={handleWirelessConnect}
                  disabled={isConnecting}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium py-2 rounded text-sm transition-colors"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </>
          ) : wirelessMode === 'pair' ? (
            <>
              <p className="text-xs text-gray-400 mb-3">
                On your Android device: Settings → Developer options → Wireless debugging → Pair with code
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="IP Address (e.g., 192.168.1.100)"
                  value={wirelessIp}
                  onChange={(e) => setWirelessIp(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Pairing Port"
                    value={pairingPort}
                    onChange={(e) => setPairingPort(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500"
                  />
                  <input
                    type="text"
                    placeholder="6-Digit Code"
                    value={pairingCode}
                    onChange={(e) => setPairingCode(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500"
                    maxLength={6}
                  />
                </div>
                <button
                  onClick={handleWirelessPair}
                  disabled={isConnecting}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg text-sm transition-colors"
                >
                  {isConnecting ? 'Pairing...' : 'Pair Device'}
                </button>
              </div>
            </>
          ) : (
            /* QR Code Mode */
            <>
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto mb-3 bg-gray-800 rounded-xl flex items-center justify-center">
                  <svg className="w-10 h-10 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-300 font-medium">Pair with QR Code</p>
                <p className="text-xs text-gray-500 mt-1">
                  On Android: Wireless debugging → Pair with QR code → Copy the data
                </p>
              </div>
              <div className="space-y-3">
                <textarea
                  placeholder="Paste QR code data here...&#10;Format: IP:PORT:CODE or scan the QR and paste the text"
                  value={qrData}
                  onChange={(e) => setQrData(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 h-24 resize-none text-sm"
                />
                <button
                  onClick={handleQrParse}
                  className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-lg text-sm transition-colors"
                >
                  Parse QR Data
                </button>
                <div className="text-center">
                  <p className="text-xs text-gray-500">
                    💡 Use a QR scanner app to read the code, then paste the text here
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="mt-4 pt-3 border-t border-gray-600">
            <p className="text-xs text-gray-500">
              💡 For older devices (pre-Android 11), connect via USB first and run: <code className="bg-gray-800 px-1 rounded">adb tcpip 5555</code>
            </p>
          </div>
        </div>
      )}

      {/* User selector */}
      {selectedDevice && selectedDevice.users.length > 1 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <label className="text-sm font-medium text-gray-400 block mb-2">
            Android User
          </label>
          <select
            value={selectedUser}
            onChange={(e) => selectUser(parseInt(e.target.value))}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            {selectedDevice.users.map((user) => (
              <option key={user.id} value={user.id}>
                User {user.id}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
