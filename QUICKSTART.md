# Quick Start - Testing 3 Versions

## 1. HTTP Polling (Original)
```bash
cd bedrock-headless
npm run node
```
✅ **No additional setup needed**

---

## 2. WebSocket (Recommended)

### Setup:
1. Install ws di Next.js project:
```bash
cd ..
npm install ws
```

2. Update .env di bedrock-headless:
```bash
WS_URL=ws://localhost:3000
```

3. Start node server:
```bash
cd bedrock-headless
npm run node:ws
```

### Testing:
- Buka dashboard web
- Create bot
- Check latency di console logs
- Expected: Command diterima **instant** (<200ms)

---

## 3. Firebase Realtime

### Setup:
1. Buat Firebase project di https://console.firebase.google.com
2. Pilih "Realtime Database" dan enable
3. Copy config ke .env di bedrock-headless:
```bash
FIREBASE_API_KEY=AIza...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abc123
```

4. Set Firebase rules (allow write untuk testing):
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

5. Start node server:
```bash
npm run node:firebase
```

### Testing:
- Buka dashboard web  
- Create bot
- Check latency
- Expected: Command diterima **instant** (~100-300ms)

---

## Benchmark Test

Test ketiganya dengan create 3 bots sekaligus:

```bash
# Terminal 1: HTTP Polling
npm run node
# Expected latency: ~3 seconds

# Terminal 2: WebSocket  
npm run node:ws
# Expected latency: <200ms

# Terminal 3: Firebase
npm run node:firebase
# Expected latency: ~100-300ms
```

Dari dashboard, klik "Start All Bots" dan check logs:

**HTTP Polling:**
```
[11:00:00] Received 3 command(s)
[11:00:00] Processing bot 1...
[11:00:03] Processing bot 2...  <-- 3s delay
[11:00:06] Processing bot 3...  <-- 6s delay
```

**WebSocket:**
```
[11:00:00] New command: start bot 1
[11:00:00] Processing bot 1...
[11:00:03] Processing bot 2...  <-- 3s delay (sequential)
[11:00:06] Processing bot 3...  <-- still instant receive
```

**Firebase:**
```
[11:00:00] New command: start bot 1
[11:00:00] Processing bot 1...
[11:00:03] Processing bot 2...
[11:00:06] Processing bot 3...
```

---

## Winner: WebSocket ⚡

**Why:**
- ✅ Instant command (<200ms)
- ✅ Efficient bandwidth
- ✅ Simple setup (no Firebase account needed)
- ✅ Works on VPS
- ❌ Only downside: manual reconnect logic (already implemented)

**Firebase is good if:**
- Banyak node (10+ servers)
- Butuh offline persistence
- Budget ada

**HTTP Polling tetap berguna if:**
- Prototyping/testing
- Simpel deployment
- Tidak butuh real-time
