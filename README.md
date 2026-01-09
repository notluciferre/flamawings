# Bedrock Headless Client

Simple headless Bedrock client untuk koneksi ke Minecraft Bedrock server.

## 🎯 Features

- Connect ke Bedrock server
- Execute commands
- Auto-ping dengan command ke server
- Auto-reconnect jika server tidak merespon
- Ping monitoring dengan timeout detection

## 📁 Struktur

```
src/
└── index.js              # Main program

config.json               # Konfigurasi
package.json              # Dependencies
```

## ⚙️ Configuration

File `config.json`:

```json
{
  "server": {
    "ip": "example.server.net",
    "port": 19132
  },
  "ping": {
    "intervalMs": 5000,
    "timeoutMs": 15000,
    "command": "ping",
    "autoReconnect": true,
    "reconnectDelayMs": 3000
  }
}
```

### Konfigurasi:

- `server.ip` - IP atau hostname server
- `server.port` - Port server (default: 19132)
- `ping.intervalMs` - Interval kirim ping command (ms)
- `ping.timeoutMs` - Timeout untuk deteksi disconnect (ms)
- `ping.command` - Command yang dikirim untuk ping (default: "ping")
- `ping.autoReconnect` - Enable/disable auto-reconnect
- `ping.reconnectDelayMs` - Delay sebelum reconnect (ms)

## 🚀 Usage

Install dependencies:

```bash
npm install
```

Run program:

```bash
npm start
```

## 📝 Commands

- `connect` - Connect ke server
- `disconnect` - Disconnect dari server
- `exec <command>` - Execute command (contoh: `exec help`, `exec list`)
- `exit` - Keluar dari program

## 📦 Dependencies

- `bedrock-protocol` - Minecraft Bedrock protocol implementation

- `canTransition(newState)`: Validasi transisi
- `setCommandsAvailable()`: Mark commands ready
- `setInventoryReady()`: Mark inventory ready
- `checkReadyState()`: Auto-transition ke READY jika semua syarat terpenuhi

#### 2. **BedrockClient.js**

Handle koneksi RakNet dan lifecycle packets:

- RakNet handshake otomatis (bedrock-protocol)
- `play_status` → LOGIN_SUCCESS
- `resource_pack_stack` → Send accept
- `start_game` → Request chunk radius
- `available_commands` → Set commands ready
- `inventory_content` (windowId=0) → Set inventory ready

**Mode Support**:

- `headless`: Pure protocol, viewDistance=4, skipPing=true
- `gui`: Experimental rendering, viewDistance=8 (future: electron window)

#### 3. **CommandHandler.js**

Kirim command sebagai PLAYER:

```javascript
sendCommand(command) {
  packet = {
    command: "/tpa",
    origin: { type: 'player' },  // PLAYER origin
    internal: false,              // MUST be false
    version: 52
  }
  client.write('command_request', packet)
}
```

- `waitForReady()`: Promise-based wait for READY state
- `scheduleCommand()`: Delayed command execution

#### 4. **GUIHandler.js**

Handle chest GUI dan slot clicking:

**Packet Sequence**:

```
Server → container_open (windowId, type)
Server → inventory_content (windowId, slots[])
Client → inventory_transaction (NORMAL, CONTAINER, windowId, slot)
Server → container_close
```

**Click Implementation**:

```javascript
clickSlot(slotIndex) {
  transaction = {
    transaction_type: 'normal',
    actions: [{
      source_type: 'container',
      window_id: this.containerData.windowId,
      slot: slotIndex,
      old_item: { network_id: 0, count: 0 },
      new_item: { network_id: 0, count: 0 }
    }]
  }
}
```

**Safety Checks**:

- Tunggu `ContainerOpenPacket` untuk dapat windowId
- Tunggu `InventoryContentPacket` sebelum click
- Timeout jika tidak ada response

---

## 🔄 State Machine Diagram

```
[DISCONNECTED]
     ↓
[CONNECTING] ─────────→ [ERROR]
     ↓                      ↑
[AUTHENTICATING] ──────────┤
     ↓                      │
[RESOURCE_PACKS] ──────────┤
     ↓                      │
[SPAWNING] ────────────────┤
     ↓                      │
[WAITING_COMMANDS] ────────┤
     ↓ (commands + inventory ready)
[READY] ───────────────────┤
     ↓                      │
[COMMAND_SENT] ────────────┤
     ↓                      │
[WAITING_GUI] ─────────────┤
     ↓ (timeout: 10s)       │
[GUI_RECEIVED] ────────────┤
     ↓ (auto after 500ms)   │
[CLICKING_SLOT] ───────────┤
     ↓                      │
[COMPLETED] ←──────────────┘
```

**Transisi Kunci**:

- `WAITING_COMMANDS` → `READY`: Butuh `commandsAvailable=true` DAN `inventoryReady=true`
- `WAITING_GUI` → `GUI_RECEIVED`: Saat terima `ContainerOpenPacket`
- `GUI_RECEIVED` → `CLICKING_SLOT`: Auto 500ms setelah `InventoryContentPacket`
- `CLICKING_SLOT` → `COMPLETED`: Saat terima `ContainerClosePacket`

---

## 📦 Packet Timeline (Urut)

### Phase 1: Connection & Login

| #   | Direction | Packet                                      | Trigger/Response             |
| --- | --------- | ------------------------------------------- | ---------------------------- |
| 1   | C→S       | RakNet handshake                            | bedrock-protocol auto        |
| 2   | C→S       | `login`                                     | bedrock-protocol auto        |
| 3   | S→C       | `play_status` (LOGIN_SUCCESS)               | Transition ke AUTHENTICATING |
| 4   | S→C       | `resource_pack_stack`                       | -                            |
| 5   | C→S       | `resource_pack_client_response` (completed) | Accept all packs             |
| 6   | S→C       | `start_game`                                | Transition ke SPAWNING       |
| 7   | C→S       | `request_chunk_radius` (radius=4)           | Request chunks               |

### Phase 2: Spawn & Ready

| #   | Direction | Packet                           | Trigger/Response           |
| --- | --------- | -------------------------------- | -------------------------- |
| 8   | S→C       | `available_commands`             | Set commandsAvailable=true |
| 9   | S→C       | `inventory_content` (windowId=0) | Set inventoryReady=true    |
| 10  | -         | spawn event                      | Client fully spawned       |
| 11  | -         | Auto transition                  | READY state achieved       |

### Phase 3: Command & GUI

| #   | Direction | Packet                                      | Trigger/Response           |
| --- | --------- | ------------------------------------------- | -------------------------- |
| 12  | C→S       | `command_request` ("/tpa", PLAYER origin)   | After 5s delay             |
| 13  | -         | Transition                                  | COMMAND_SENT → WAITING_GUI |
| 14  | S→C       | `container_open` (windowId, type=CONTAINER) | Save windowId              |
| 15  | -         | Transition                                  | GUI_RECEIVED               |
| 16  | S→C       | `inventory_content` (windowId=N)            | Chest slots data           |
| 17  | C→S       | `inventory_transaction` (NORMAL, slot=16)   | After 500ms                |
| 18  | S→C       | `container_close`                           | Success signal             |
| 19  | -         | Transition                                  | COMPLETED                  |

---

## 🎛️ Konfigurasi

```json
{
  "mode": "headless", // "headless" atau "gui"
  "server": {
    "host": "donutsmp.net",
    "port": 19132,
    "version": "1.21.50"
  },
  "auth": {
    "username": "YourXboxUsername",
    "offline": false // true = cracked, false = Xbox auth
  },
  "behavior": {
    "commandDelayMs": 5000, // Delay setelah ready
    "guiTimeoutMs": 10000, // Timeout tunggu GUI
    "slotIndex": 16, // Slot yang di-click (0-based)
    "targetCommand": "/tpa", // Command yang dikirim
    "keepAlive": false // Keep connection setelah selesai
  },
  "debug": {
    "logPackets": true,
    "logStateChanges": true
  }
}
```

### Mode: GUI vs Headless

| Feature       | Headless   | GUI              |
| ------------- | ---------- | ---------------- |
| Rendering     | ❌ None    | ⚠️ Experimental  |
| View Distance | 4 chunks   | 8 chunks         |
| Performance   | ⚡ Fast    | 🐌 Slower        |
| Use Case      | Automation | Debugging/Visual |

**GUI Mode**:

- Saat ini hanya log warning, rendering belum implemented
- Future: integrate dengan `electron-minecraft-window` atau `prismarine-viewer`
- Tetap bisa automasi, hanya visual saja yang berbeda

---

## 💻 Pseudocode Implementasi

### connectServer()

```javascript
async function connectServer() {
  options = {
    host: "donutsmp.net",
    port: 19132,
    username: config.auth.username,
    offline: config.auth.offline,
    viewDistance: mode === "gui" ? 8 : 4,
    keepAlive: true,
  };

  client = bedrock.createClient(options);

  // Setup handlers
  client.on("play_status", handlePlayStatus);
  client.on("resource_pack_stack", handleResourcePacks);
  client.on("start_game", handleStartGame);
  client.on("available_commands", handleCommands);
  client.on("inventory_content", handleInventory);

  // Wait for spawn
  await waitForEvent("spawn");

  return client;
}
```

### sendCommand()

```javascript
function sendCommand(command) {
  // Pre-check
  if (!stateMachine.canSendCommand()) {
    return false;
  }

  // Ensure slash prefix
  cmd = command.startsWith("/") ? command : "/" + command;

  // Build packet
  packet = {
    command: cmd,
    origin: {
      type: "player", // CRITICAL: PLAYER not SERVER
      uuid: "",
      request_id: "",
    },
    internal: false, // CRITICAL: Must be false
    version: 52,
  };

  // Send
  client.write("command_request", packet);
  stateMachine.transition(COMMAND_SENT);

  // Auto-transition after 100ms
  setTimeout(() => {
    stateMachine.transition(WAITING_GUI);
  }, 100);

  return true;
}
```

### waitForChest()

```javascript
function waitForChest(timeoutMs) {
  timeout = setTimeout(() => {
    if (state == WAITING_GUI) {
      stateMachine.transition(ERROR, "GUI timeout");
    }
  }, timeoutMs);

  client.on("container_open", (packet) => {
    clearTimeout(timeout);

    containerData.windowId = packet.window_id;
    containerData.type = packet.type;

    stateMachine.transition(GUI_RECEIVED);
  });

  client.on("inventory_content", (packet) => {
    if (packet.window_id == containerData.windowId) {
      containerData.slots = packet.input;
      containerData.received = true;

      // Auto-click after 500ms
      setTimeout(() => {
        clickSlot(config.slotIndex);
      }, 500);
    }
  });
}
```

### clickSlot(windowId, slotIndex)

```javascript
function clickSlot(slotIndex) {
  // Pre-checks
  if (!containerData.windowId) {
    error("No windowId available");
    return false;
  }

  if (!containerData.received) {
    error("Inventory content not received");
    return false;
  }

  if (state != GUI_RECEIVED) {
    error("Invalid state for clicking");
    return false;
  }

  // Transition
  stateMachine.transition(CLICKING_SLOT);

  // Build transaction packet
  transaction = {
    transaction_type: "normal", // NORMAL (not MISMATCH or USE_ITEM)
    actions: [
      {
        source_type: "container", // CONTAINER source
        window_id: containerData.windowId,
        slot: slotIndex,
        old_item: {
          network_id: 0,
          count: 0,
        },
        new_item: {
          network_id: 0,
          count: 0,
        },
      },
    ],
  };

  // Send packet
  client.write("inventory_transaction", transaction);

  // Success timeout fallback
  setTimeout(() => {
    if (state == CLICKING_SLOT) {
      stateMachine.transition(COMPLETED, "Assumed success");
    }
  }, 5000);

  return true;
}
```

---

## ⚠️ Edge Cases DonutSMP

### 1. **Anti-Bot Detection**

- **Issue**: Server mungkin detect terlalu cepat
- **Mitigasi**:
  - `commandDelayMs: 5000` (tunggu 5 detik setelah spawn)
  - Delay 500ms antara GUI received dan click
  - Tidak spam packet
  - Login dengan Xbox auth (bukan offline)

### 2. **Form GUI Instead of Chest**

- **Issue**: DonutSMP mungkin pakai `ModalFormRequestPacket` bukan `ContainerOpenPacket`
- **Detection**: Listen `modal_form_request`
- **Mitigasi**:
  ```javascript
  client.on("modal_form_request", (packet) => {
    formData = JSON.parse(packet.data);
    // Parse button array, click index 16 dengan modal_form_response
    client.write("modal_form_response", {
      form_id: packet.form_id,
      data: buttonIndex, // atau JSON response
    });
  });
  ```

### 3. **Multiple GUI Sequence**

- **Issue**: /tpa bisa buka GUI → pilih player → konfirmasi
- **Mitigasi**:
  - Track `windowId` per GUI
  - Handle multiple `container_open` events
  - State machine bisa extend: `GUI_RECEIVED_1`, `GUI_RECEIVED_2`

### 4. **Timing Issues**

- **Issue**: Click sebelum `InventoryContentPacket` = gagal
- **Mitigasi**:
  - Flag `containerData.received`
  - Auto-click hanya setelah flag true
  - Delay 500ms safety margin

### 5. **Server Lag**

- **Issue**: Packet delayed, timeout premature
- **Mitigasi**:
  - `guiTimeoutMs: 10000` (generous timeout)
  - Click timeout 5000ms
  - Log warning tapi tetap lanjut

### 6. **Permission Denied**

- **Issue**: Server reject command (no permission)
- **Detection**:
  ```javascript
  client.on("text", (packet) => {
    if (
      packet.message.includes("permission") ||
      packet.message.includes("deny")
    ) {
      stateMachine.transition(ERROR, "No permission");
    }
  });
  ```

### 7. **Slot Index Mismatch**

- **Issue**: DonutSMP slot 16 might not be correct
- **Debug**: Log `inventory_content` slots:
  ```javascript
  containerData.slots.forEach((item, index) => {
    logger.info(`Slot ${index}: ${item.name}`);
  });
  ```

---

## 🚀 Usage

### Install Dependencies

```bash
npm install
```

### Configure

Edit `config.json`:

- Set Xbox `username`
- Choose `mode`: `"headless"` or `"gui"`
- Adjust `slotIndex` jika perlu

### Run

```bash
npm start
```

### Development

```bash
npm run dev  # Auto-reload on file changes
```

---

## 📊 Expected Output

```
============================================================
BEDROCK AFK CLIENT - DonutSMP Automation
============================================================
Target: donutsmp.net:19132
Mode: headless
Command: /tpa
Slot: 16
============================================================
[INFO] 2026-01-04T10:30:00.000Z - Mode: HEADLESS
[INFO] 2026-01-04T10:30:00.100Z - Connecting to donutsmp.net:19132
[STATE] DISCONNECTED → CONNECTING | Starting connection
[PKT] ← play_status {"status":"login_success"}
[STATE] CONNECTING → AUTHENTICATING | Login successful
[PKT] ← resource_pack_stack
[STATE] AUTHENTICATING → RESOURCE_PACKS | Resource pack negotiation
[PKT] → resource_pack_client_response
[PKT] ← start_game {"entity_id":"12345","gamemode":"survival"}
[STATE] RESOURCE_PACKS → SPAWNING | Game started
[PKT] → request_chunk_radius
[PKT] ← available_commands {"count":47}
[STATE] SPAWNING → WAITING_COMMANDS | Waiting for inventory
[PKT] ← inventory_content {"window_id":0}
[STATE] WAITING_COMMANDS → READY | Commands & Inventory ready
[INFO] 2026-01-04T10:30:05.000Z - Client is READY!
[INFO] 2026-01-04T10:30:05.001Z - Sending command in 5000ms...
[PKT] → command_request {"command":"/tpa","origin":"player"}
[STATE] READY → COMMAND_SENT | Sending: /tpa
[STATE] COMMAND_SENT → WAITING_GUI | Waiting for GUI response
[INFO] 2026-01-04T10:30:05.200Z - Waiting for GUI (timeout: 10000ms)...
[PKT] ← container_open {"window_id":12,"type":"container"}
[STATE] WAITING_GUI → GUI_RECEIVED | Container opened
[INFO] 2026-01-04T10:30:05.500Z - Container opened: type=container, windowId=12
[PKT] ← inventory_content {"window_id":12,"slot_count":27}
[INFO] 2026-01-04T10:30:05.600Z - Container inventory received: 27 slots
[INFO] 2026-01-04T10:30:05.601Z - Auto-clicking slot 16 in 500ms...
[STATE] GUI_RECEIVED → CLICKING_SLOT | Clicking slot 16
[PKT] → inventory_transaction {"type":"normal","window_id":12,"slot":16}
[INFO] 2026-01-04T10:30:06.200Z - Slot 16 clicked in windowId 12
[PKT] ← container_close {"window_id":12}
[STATE] CLICKING_SLOT → COMPLETED | Slot clicked, GUI closed
[INFO] 2026-01-04T10:30:06.300Z - Container closed by server
============================================================
✓ TASK COMPLETED SUCCESSFULLY
============================================================
[INFO] 2026-01-04T10:30:06.400Z - Disconnecting in 3 seconds...
```

---

## 🔧 Troubleshooting

### Issue: "Cannot send command: state not READY"

- **Cause**: Commands or inventory not ready
- **Fix**: Tunggu lebih lama, cek log `available_commands` dan `inventory_content`

### Issue: "GUI timeout: no ContainerOpen received"

- **Cause**: Server tidak kirim chest GUI (mungkin Form GUI)
- **Fix**: Add handler untuk `modal_form_request`

### Issue: "Kicked: Invalid move"

- **Cause**: Bedrock protocol version mismatch
- **Fix**: Update `config.server.version` sesuai server

### Issue: Slot click tidak response

- **Cause**: Slot index salah atau timing issue
- **Fix**:
  - Log `inventory_content` untuk lihat slot data
  - Increase delay sebelum click

---

## 📝 Notes

### Asumsi

1. DonutSMP menggunakan **Chest GUI** untuk /tpa (bukan Form GUI)
2. Slot target adalah index **16** (0-based, row 2 col 8)
3. Server support **CommandRequestPacket** (Bedrock standard)
4. Tidak ada captcha atau challenge-response anti-bot

### Tidak Dilakukan

- ❌ Bypass permission checks
- ❌ Spoof command origin ke SERVER
- ❌ Spam packets atau rapid clicking
- ❌ Exploit server vulnerabilities
- ❌ Use ChatPacket untuk command

### Compliance

✅ Valid Bedrock Protocol  
✅ Player origin untuk commands  
✅ Normal inventory transaction  
✅ Realistic timing dan delays  
✅ Xbox authentication support

---

## 📚 References

- [Bedrock Protocol Documentation](https://github.com/PrismarineJS/bedrock-protocol)
- [Minecraft Bedrock Packets](https://wiki.vg/Bedrock_Protocol)
- Slot index: 0-based, row-major order (0-8 = row 1, 9-17 = row 2, dll)
- ContainerType: 0=CONTAINER, 1=WORKBENCH, 2=FURNACE, etc

---

**Mode GUI vs Headless**: Sekarang sudah support 2 mode di config. GUI mode experimental untuk future rendering, headless mode untuk pure automation.
