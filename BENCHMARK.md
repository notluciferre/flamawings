# CakraNode - Performance Benchmark

## 3 Versi Berbeda untuk Dibandingkan

### 1. HTTP Polling (Original)
**File:** `node-server.js`
**Cara Jalankan:**
```bash
npm run node
```

**Karakteristik:**
- ✅ Simpel, tidak perlu setup tambahan
- ❌ Delay 3 detik per poll (bisa lebih lambat)
- ❌ Bandwidth lebih boros (polling terus)
- ❌ Tidak real-time

**Latency:** ~3000ms (tergantung poll interval)

---

### 2. WebSocket (Real-time)
**File:** `node-server-ws.js`
**Cara Jalankan:**
```bash
npm install ws
npm run node:ws
```

**Karakteristik:**
- ✅ Real-time instant command
- ✅ Bidirectional communication
- ✅ Bandwidth efficient (hanya kirim saat ada data)
- ❌ Perlu WebSocket API route di Next.js
- ❌ Bisa disconnect kalau network unstable

**Latency:** ~50-200ms (instant)

**Setup Required:**
1. Install ws di Next.js: `npm install ws`
2. API route sudah dibuat di `src/app/api/ws/node/route.ts`
3. Set `WS_URL` di .env: `WS_URL=ws://localhost:3000` (dev) atau `WS_URL=wss://cakranode.vercel.app` (prod)

---

### 3. Firebase Realtime Database
**File:** `node-server-firebase.js`
**Cara Jalankan:**
```bash
npm install firebase
npm run node:firebase
```

**Karakteristik:**
- ✅ Real-time instant command
- ✅ Auto-reconnect by Firebase
- ✅ Offline persistence (data disimpan sementara)
- ✅ Scalable (support banyak node)
- ❌ Perlu Firebase project setup
- ❌ Ada cost kalau traffic tinggi

**Latency:** ~100-300ms (tergantung Firebase region)

**Setup Required:**
1. Buat Firebase project di https://console.firebase.google.com
2. Enable Realtime Database
3. Tambahkan config ke `.env`:
```
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

---

## Cara Benchmark

### 1. Test Response Time
Start bot dan ukur berapa lama sampai spawn:

```bash
# HTTP Polling
time npm run node

# WebSocket
time npm run node:ws

# Firebase
time npm run node:firebase
```

### 2. Test Command Latency
Dari dashboard, klik "Start Bot" dan ukur:
- **HTTP Polling:** Command diterima setelah max 3 detik (poll interval)
- **WebSocket:** Command diterima instant (<200ms)
- **Firebase:** Command diterima instant (~100-300ms)

### 3. Test Network Usage
Monitor bandwidth usage selama 1 jam:

**HTTP Polling:**
- Request per jam: 1200 requests (3600s / 3s)
- Data per request: ~500 bytes (minimal)
- Total bandwidth: ~600 KB/jam

**WebSocket:**
- Initial connection: 1 request
- Heartbeat: 360 requests/jam (10s interval)
- Total bandwidth: ~180 KB/jam

**Firebase:**
- Realtime listener: Minimal bandwidth
- Total bandwidth: ~100 KB/jam

### 4. Test Reliability
Simulasi network drop:
1. Disconnect internet 10 detik
2. Reconnect
3. Check berapa lama sampai connection recovery

**Expected:**
- HTTP Polling: Recovery dalam 3 detik (next poll)
- WebSocket: Auto-reconnect 5 detik
- Firebase: Auto-reconnect instant (built-in Firebase)

---

## Hasil Benchmark (Predicted)

| Metric | HTTP Polling | WebSocket | Firebase |
|--------|-------------|-----------|----------|
| **Command Latency** | ~3000ms | ~50-200ms | ~100-300ms |
| **Bandwidth/Hour** | ~600 KB | ~180 KB | ~100 KB |
| **Real-time** | ❌ No | ✅ Yes | ✅ Yes |
| **Auto-reconnect** | ❌ No | ⚠️ Manual | ✅ Built-in |
| **Setup Complexity** | ⭐ Easy | ⭐⭐ Medium | ⭐⭐⭐ Hard |
| **Scalability** | ⭐⭐ Limited | ⭐⭐⭐ Good | ⭐⭐⭐⭐ Excellent |
| **Cost** | 💰 Free | 💰 Free | 💰💰 Paid (Firebase) |

---

## Rekomendasi

**Gunakan HTTP Polling jika:**
- Baru mulai develop
- Tidak butuh real-time
- Simpel setup

**Gunakan WebSocket jika:**
- Butuh real-time command
- VPS/server sendiri
- Bisa maintain WebSocket connection

**Gunakan Firebase jika:**
- Butuh real-time + reliability
- Banyak node (scalable)
- Budget ada untuk Firebase

---

## Testing Commands

```bash
# Install dependencies
cd bedrock-headless
npm install

# Test HTTP Polling
npm run node

# Test WebSocket
npm run node:ws

# Test Firebase
npm run node:firebase
```

Lalu dari dashboard web, test dengan:
1. Create 3 bots sekaligus
2. Ukur berapa lama sampai semua spawn
3. Check logs untuk command latency
4. Monitor network usage dengan browser DevTools

**Winner expected:** WebSocket (balance antara speed dan simplicity)
