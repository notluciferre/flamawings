# Auto Shop Testing Guide

## Overview
Script untuk testing auto shop system yang bisa otomatis membeli item dari shop in-game berdasarkan image sequence training data.

## Features
- ✅ Otomatis execute `/shop` command
- ✅ Navigate ke kategori yang diinginkan (contoh: "shard")
- ✅ Pilih item spesifik (contoh: "skeleton spawner")
- ✅ Input quantity
- ✅ Auto confirm pembelian
- ✅ **CLI arguments untuk custom category/item/quantity**
- ✅ **Debug mode untuk troubleshooting**

## Quick Start

### Basic usage (default: shard, skeleton spawner, qty 1)
```bash
npm run debug
```

### Custom category, item, and quantity
```bash
node src/test-auto-shop.js "blocks" "stone" 64
node src/test-auto-shop.js "tools" "diamond pickaxe" 1
node src/test-auto-shop.js "food" "golden apple" 10
```

### Debug mode (see all packets)
```bash
node src/test-auto-shop.js "shard" "skeleton spawner" 1 --debug
```

## Command Format

```bash
node src/test-auto-shop.js [category] [item] [quantity] [--debug]
```

**Arguments:**
- `category` - Shop category (shard, blocks, tools, weapons, armor, food, etc.)
- `item` - Item name (case-insensitive, partial match)
- `quantity` - Number of items to buy (default: 1)
- `--debug` - Enable debug mode to see all packets

**Examples:**
```bash
# Buy 5 zombie spawners from shard category
node src/test-auto-shop.js shard "zombie spawner" 5

# Buy 64 cobblestone from blocks
node src/test-auto-shop.js blocks cobblestone 64

# Debug mode to see what's happening
node src/test-auto-shop.js shard "skeleton spawner" 1 --debug
```

## File Structure
```
bedrock-headless/
├── src/
│   └── test-auto-shop.js    # Main testing script
├── config.json               # Bot configuration
└── AUTO_SHOP_TESTING.md     # Documentation
```

## Configuration

Edit bagian `SHOP_CONFIG` di `test-auto-shop.js`:

```javascript
const SHOP_CONFIG = {
  targetCategory: 'shard',        // Kategori yang dicari
  targetItem: 'skeleton spawner', // Item yang akan dibeli
  quantity: 1,                    // Jumlah
  autoConfirm: true,             // Auto confirm purchase
};
```

Edit `config.json` untuk bot credentials:

```json
{
  "testBot": {
    "username": "YourBotName",
    "server_ip": "donutsmp.net",
    "server_port": 19132
  }
}
```

## How to Run

1. **Install dependencies** (jika belum):
   ```bash
   npm install
   ```

2. **Edit configuration**:
   - Buka `src/test-auto-shop.js`
   - Set `targetCategory` dan `targetItem` sesuai kebutuhan
   - Set `quantity` berapa banyak yang mau dibeli

3. **Run test**:
   ```bash
   cd bedrock-headless
   node src/test-auto-shop.js
   ```

4. **Monitor logs**:
   - Bot akan connect ke server
   - Setelah spawn, tunggu 3 detik lalu execute `/shop`
   - Bot akan otomatis navigate dan membeli item
   - Check log untuk status purchase

## Expected Output

```
[10:30:45] [INFO]: === Auto Shop Test ===
[10:30:45] [INFO]: Target: skeleton spawner from shard category
[10:30:45] [INFO]: Quantity: 1
[10:30:45] [INFO]: Connecting as TestAutoShop to donutsmp.net:19132...
[10:30:47] [INFO]: ✓ Spawned! Waiting 3 seconds before opening shop...
[10:30:50] [INFO]: Executing: /shop
[10:30:51] [INFO]: Searching for category: shard
[10:30:51] [INFO]: ✓ Found category button at index 3: shard
[10:30:51] [INFO]: → Selected category: shard
[10:30:52] [INFO]: Searching for item: skeleton spawner
[10:30:52] [INFO]: ✓ Found item button at index 5: skeleton spawner
[10:30:52] [INFO]: → Selected item: skeleton spawner
[10:30:53] [INFO]: Entering quantity: 1
[10:30:53] [INFO]: → Entered quantity: 1
[10:30:54] [INFO]: Confirmation screen detected
[10:30:54] [INFO]: ✓ Confirming purchase with button: yes
[10:30:54] [INFO]: → Purchase confirmed!
[10:30:55] [INFO]: [SERVER] You have purchased Skeleton Spawner x1 for $500
[10:30:55] [INFO]: ✓✓✓ Purchase successful! ✓✓✓
```

## Troubleshooting

### Stuck after "/shop" command (no form received)

**Symptoms:**
```
[11:08:23] [INFO]: Executing: /shop
[11:08:33] [ERROR]: ⏱️ Timeout: No shop form received after 10 seconds
```

**Possible causes:**
1. Server uses different command (maybe `/shopgui`, `/market`, `/store`)
2. No permission to use shop
3. Shop plugin not responding
4. Form packets not captured correctly

**Solutions:**

**A) Try debug mode to see all packets:**
```bash
node src/test-auto-shop.js shard "skeleton spawner" 1 --debug
```
Look for packets like `modal_form_request`, `simple_form_request`, or `server_settings_response`

**B) Test with in-game client:**
- Connect with normal Minecraft Bedrock client
- Type `/shop` and see what happens
- Check if it opens a form/UI
- Take note of the exact command used

**C) Check server response:**
If you see text message response instead of form:
```
[SERVER] Unknown command: shop
[SERVER] Shop is disabled
[SERVER] You don't have permission
```
This means the command doesn't work or needs different format.

**D) Try alternative shop commands:**
```bash
# Common alternatives
node src/test-auto-shop.js shard "skeleton spawner" 1  # using /shop
# or manually edit test script to use:
# /shopgui
# /market
# /store
# /buy
```

### Category not found
```
[ERROR] Category "shard" not found in buttons
[DEBUG] Available buttons: blocks, tools, weapons, armor, food
```
**Solution**: Check spelling dan coba gunakan salah satu category yang available.

### Item not found
```
[ERROR] Item "skeleton spawner" not found in category
[DEBUG] Available items: zombie spawner, spider spawner, creeper spawner
```
**Solution**: Check item name dan gunakan exact name dari list.

### Not enough money
```
[ERROR] Purchase failed: Not enough money/resources
```
**Solution**: Bot perlu punya balance yang cukup untuk membeli item.

### Form parsing error
```
[ERROR] Failed to parse form data
```
**Solution**: Server mungkin pakai format form yang berbeda. Check debug logs untuk struktur form.

## State Machine Flow

```
idle
  ↓ (execute /shop)
waiting_category
  ↓ (select category)
waiting_item
  ↓ (select item)
waiting_quantity
  ↓ (input quantity)
waiting_confirm
  ↓ (confirm purchase)
idle (done)
```

## Integration ke CakraNode

Setelah testing berhasil, fitur ini bisa diintegrasikan ke:

1. **node-server-firebase.js** - Tambahkan handler untuk `modal_form_request`
2. **Frontend** - Buat UI untuk configure auto shop
3. **Firebase** - Store shop configuration per bot
4. **API Route** - Endpoint untuk trigger auto shop

## Debug Mode

Untuk melihat semua form data yang dikirim server:

```javascript
client.on('modal_form_request', (packet) => {
  console.log('RAW FORM DATA:', packet.data);
  const formData = JSON.parse(packet.data);
  console.log('PARSED FORM:', JSON.stringify(formData, null, 2));
});
```

## Notes

- Bot harus sudah spawn sebelum bisa execute command
- Form UI bisa berbeda tergantung server plugin/setup
- Timing antara form response penting (500ms delay recommended)
- Auto-confirm bisa di-disable untuk manual confirmation
- Test dulu dengan small quantity sebelum bulk buying

---

## Quick Reference

### CLI Examples
```bash
# Default (shard, skeleton spawner, 1)
npm run debug

# Custom item
node src/test-auto-shop.js blocks stone 64

# With debug
node src/test-auto-shop.js shard "zombie spawner" 5 --debug

# Multiple words in item name (use quotes)
node src/test-auto-shop.js weapons "diamond sword" 1
```

### Config File (config.json)
```json
{
  "testBot": {
    "username": "YourBotName",
    "server_ip": "donutsmp.net",
    "server_port": 19132,
    "offline_mode": false  // true = no Xbox auth, false = Xbox auth required
  }
}
```

### Packet Types to Watch (Debug Mode)
- `modal_form_request` - Main form UI
- `simple_form_request` - Alternative form type
- `text` - Chat messages (success/error)
- `command_request` - Sent commands

### Common Categories
- `shard` - Spawners, special items
- `blocks` - Building blocks
- `tools` - Pickaxes, shovels, axes
- `weapons` - Swords, bows
- `armor` - Helmets, chestplates, leggings, boots
- `food` - Edible items
- `potions` - Potions and effects
- `misc` - Other items

