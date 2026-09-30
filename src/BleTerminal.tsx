import { useEffect, useRef, useState } from "react";

/* Nordic UART Service UUIDs — must match firmware */
const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX_UUID      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // web -> device
const TX_UUID      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // device -> web

interface BleTerminalProps {
  onClose: () => void;
}

interface LogLine {
  ts: number;
  dir: "in" | "out" | "sys" | "err";
  text: string;
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: "8px 16px", fontSize: 13, fontWeight: 600,
    background: bg, color: "#fff", border: 0, borderRadius: 4,
    cursor: "pointer",
  };
}

export default function BleTerminal({ onClose }: BleTerminalProps) {
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState("Disconnected");
  const [log, setLog] = useState<LogLine[]>([]);
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [appendNewline, setAppendNewline] = useState(true);
  const [rxCount, setRxCount] = useState(0);

  const deviceRef = useRef<any>(null);
  const rxCharRef = useRef<any>(null);   // write (web -> device)
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = (dir: LogLine["dir"], text: string) => {
    setLog((prev) => [...prev, { ts: Date.now(), dir, text }]);
  };

  useEffect(() => {
    if (!("bluetooth" in navigator)) {
      addLog("err", "Bluetooth access is unavailable in this browser. Open this app in Chrome or Edge.");
      return;
    }
    addLog("sys", "Terminal ready. Select Connect to find a STEMBRAIN device.");
  }, []);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [log, autoScroll]);

  // Simple, working receive handler
  const handleReceiveData = (event: any) => {
    try {
      const value: DataView = event.target.value;
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(value);
      const clean = text.replace(/\r?\n$/, "");
      setRxCount((c) => c + 1);
      addLog("in", clean || "(empty)");
    } catch (e: any) {
      addLog("err", `Unable to read incoming data: ${e.message}`);
    }
  };

  const handleDisconnect = () => {
    try {
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
    } catch {}
    rxCharRef.current = null;
    setConnected(false);
    setStatus("Disconnected");
    addLog("sys", "Device disconnected.");
  };

  const handleConnect = async () => {
    if (!("bluetooth" in navigator)) return;

    try {
      addLog("sys", "Scanning for STEMBRAIN devices…");
      setStatus("Scanning...");

      const bleDevice = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: "STEMBRAIN" }],
        optionalServices: [SERVICE_UUID],
      });

      deviceRef.current = bleDevice;
      setDeviceName(bleDevice.name || "Unknown");

      bleDevice.addEventListener("gattserverdisconnected", () => {
        rxCharRef.current = null;
        setConnected(false);
        setStatus("Disconnected");
        addLog("sys", "Device disconnected");
      });

      addLog("sys", `Connecting to ${bleDevice.name}...`);
      setStatus("Connecting...");

      const server = await bleDevice.gatt.connect();

      addLog("sys", "Opening the device communication service…");
      const service = await server.getPrimaryService(SERVICE_UUID);

      // RX char (web -> device, we WRITE)
      const rxChar = await service.getCharacteristic(RX_UUID);
      rxCharRef.current = rxChar;

      // TX char (device -> web, we SUBSCRIBE to notify)
      const txChar = await service.getCharacteristic(TX_UUID);
      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleReceiveData);

      setConnected(true);
      setStatus("Connected");
      addLog("sys", `Connected to ${bleDevice.name}.`);
    } catch (e: any) {
      addLog("err", `Unable to connect to the device: ${e.message || e}`);
      rxCharRef.current = null;
      setConnected(false);
      setStatus("Disconnected");
    }
  };

  const handleForget = async () => {
    try {
      const dev = deviceRef.current;
      if (!dev) {
        addLog("err", "No device is available to forget. Connect to a device first.");
        return;
      }
      if (dev.gatt?.connected) dev.gatt.disconnect();
      rxCharRef.current = null;
      setConnected(false);
      setStatus("Disconnected");
      deviceRef.current = null;
      setDeviceName("");

      if (typeof dev.forget === "function") {
        await dev.forget();
        addLog("sys", "Device removed from the browser's remembered devices.");
      } else {
        addLog("err", "This browser does not support removing remembered devices.");
      }
    } catch (e: any) {
      addLog("err", `Unable to remove the remembered device: ${e.message || e}`);
    }
  };

  const handleSend = async () => {
    if (!rxCharRef.current) {
      addLog("err", "Connect to a device before sending a message.");
      return;
    }
    if (!input.trim() && !appendNewline) return;

    try {
      const payload = appendNewline ? input + "\n" : input;
      const encoder = new TextEncoder();
      const data = encoder.encode(payload);
      await rxCharRef.current.writeValue(data);
      addLog("out", input);
      setInput("");
    } catch (e: any) {
      addLog("err", `Unable to send the message: ${e.message || e}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const fmtTime = (ts: number) => new Date(ts).toTimeString().slice(0, 8);

  return (
    <div className="ble-backdrop"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div className="ble-modal"
        style={{
          width: "min(900px, 95vw)", height: "min(700px, 90vh)",
          background: "#1e1e1e", borderRadius: 8, overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div className="ble-header"
          style={{
            padding: "12px 16px", background: "#1565c0", color: "#fff",
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <strong>Device Terminal</strong>
          <span
            style={{
              padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
              background: connected ? "#2e7d32" : "#666",
            }}
          >
            {connected ? `● ${status}  [RX: ${rxCount}]` : `○ ${status}`}
          </span>
          {deviceName && (
            <span style={{ fontSize: 12, opacity: 0.9 }}>{deviceName}</span>
          )}
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", padding: "6px 14px", fontSize: 14,
              background: "#c62828", color: "#fff", border: 0, borderRadius: 4,
              cursor: "pointer", fontWeight: 600,
            }}
          >
            Close
          </button>
        </div>

        {/* Toolbar */}
        <div className="ble-toolbar"
          style={{
            padding: "10px 16px", background: "#252525", display: "flex",
            alignItems: "center", gap: 8, borderBottom: "1px solid #333",
            flexWrap: "wrap",
          }}
        >
          {!connected ? (
            <button onClick={handleConnect} style={btnStyle("#2e7d32")}>
              Connect
            </button>
          ) : (
            <button onClick={handleDisconnect} style={btnStyle("#c62828")}>
              Disconnect
            </button>
          )}
          <button onClick={handleForget} style={btnStyle("#8a4b00")}>
            Forget Device
          </button>
          <button onClick={() => setLog([])} style={btnStyle("#444")}>
            Clear
          </button>
          <label
            style={{
              color: "#ccc", fontSize: 13, marginLeft: 12,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <label
            style={{
              color: "#ccc", fontSize: 13,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <input
              type="checkbox"
              checked={appendNewline}
              onChange={(e) => setAppendNewline(e.target.checked)}
            />
            Send newline
          </label>
        </div>

        {/* Output */}
        <div className="ble-output"
          style={{
            flex: 1, overflow: "auto", padding: 12, background: "#0d0d0d",
            fontFamily: "Consolas, monospace", fontSize: 13, color: "#d4d4d4",
          }}
        >
          {log.map((line, i) => (
            <div
              key={i}
              style={{
                marginBottom: 2, whiteSpace: "pre-wrap", wordBreak: "break-all",
                color:
                  line.dir === "in"   ? "#28795f" :
                  line.dir === "out"  ? "#8b5c2d" :
                  line.dir === "err"  ? "#ad4646" : "#587168",
              }}
            >
              <span style={{ color: "#879b91", marginRight: 8 }}>{fmtTime(line.ts)}</span>
              <span style={{ marginRight: 6, opacity: 0.7 }}>
                {line.dir === "in" ? "◀" : line.dir === "out" ? "▶" :
                 line.dir === "err" ? "✗" : "•"}
              </span>
              {line.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Input */}
        <div className="ble-input-row"
          style={{
            padding: 12, background: "#252525", borderTop: "1px solid #333",
            display: "flex", gap: 8,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!connected}
            aria-label="Message to device"
            placeholder={connected ? "Enter a message and press Enter…" : "Connect to enable messaging"}
            style={{
              flex: 1, padding: "10px 12px", fontSize: 14,
              background: "#1e1e1e", color: "#d4d4d4",
              border: "1px solid #444", borderRadius: 4, outline: "none",
              fontFamily: "Consolas, monospace",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!connected}
            style={btnStyle(connected ? "#2e7d32" : "#444")}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
