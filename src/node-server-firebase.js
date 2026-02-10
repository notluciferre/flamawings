/**
 * CakraNode - Bot Node Server (Firebase Realtime Version)
 * Real-time communication using Firebase Realtime Database
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bedrock from 'bedrock-protocol';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, push, update, onChildAdded } from 'firebase/database';
import proxyManager from './proxy-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config from JSON
let config;
try {
  const configPath = path.join(__dirname, '..', 'config.json');
  const configFile = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configFile);
} catch (err) {
  console.error('❌ Failed to load config.json!');
  console.error('Please copy config.example.json to config.json and fill in your settings');
  process.exit(1);
}

// Firebase config
const firebaseConfig = {
  apiKey: config.firebase.apiKey,
  authDomain: config.firebase.authDomain,
  databaseURL: config.firebase.databaseURL,
  projectId: config.firebase.projectId,
  storageBucket: config.firebase.storageBucket,
  messagingSenderId: config.firebase.messagingSenderId,
  appId: config.firebase.appId,
};

// Configuration
const CONFIG = {
  apiUrl: config.apiUrl || 'http://localhost:3000',
  accessToken: config.accessToken,
  nodeIp: config.nodeIp || 'auto',
  proxyHost: config.proxy?.host || null,
  proxyPort: config.proxy?.port || null,
  proxyUsername: config.proxy?.username || null,
  proxyPassword: config.proxy?.password || null,
};

const botClients = new Map();
let nodeId = null;
let db = null;

// Logger
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function logInfo(msg) { console.log(`[${getTimestamp()}] [INFO]: ${msg}`); }
function logWarn(msg) { console.log(`[${getTimestamp()}] [WARN]: ${msg}`); }
function logError(msg) { console.log(`[${getTimestamp()}] [ERROR]: ${msg}`); }
function logServer(msg) { console.log(`[${getTimestamp()}] [SERVER]: ${msg}`); }

// Firebase operations
function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    logInfo('Firebase initialized successfully');
    return true;
  } catch (err) {
    logError(`Firebase initialization failed: ${err.message}`);
    return false;
  }
}

function listenForCommands() {
  if (!db) {
    logError('[Error] Firebase not initialized - cannot listen for commands');
    return;
  }
  
  const commandsRef = ref(db, `nodes/${nodeId}/commands`);
  
  onChildAdded(commandsRef, async (snapshot) => {
    const command = snapshot.val();
    const commandId = snapshot.key;
    
    logInfo(`New command received: ${command.action}`);
    
    // Process command
    await processCommand(command, commandId);
    
    // Remove processed command
    await set(ref(db, `nodes/${nodeId}/commands/${commandId}`), null);
  });
  
  logInfo('Listening for commands on Firebase...');
}

async function updateNodeStatus(data) {
  if (!db) {
    logError('[Error] Firebase not initialized');
    return;
  }
  try {
    await set(ref(db, `nodes/${nodeId}/status`), {
      ...data,
      lastUpdate: Date.now(),
    });
  } catch (err) {
    logError(`Failed to update node status: ${err.message}`);
    if (err.code === 'PERMISSION_DENIED') {
      logError('❌ Firebase Rules Error! Follow these steps:');
      logError('1. Open: https://console.firebase.google.com/');
      logError('2. Select your project');
      logError('3. Go to: Realtime Database → Rules');
      logError('4. Replace with: { "rules": { ".read": true, ".write": true } }');
      logError('5. Click Publish');
      logError('6. Restart this server');
      process.exit(1);
    }
  }
}

async function updateBotStatus(botId, status, error = null) {
  if (!db) {
    logError('[Error] Firebase not initialized');
    return;
  }
  try {
    await set(ref(db, `bots/${botId}/status`), {
      status,
      error,
      timestamp: Date.now(),
    });
  } catch (err) {
    logError(`Failed to update bot status: ${err.message}`);
  }
}

async function addBotLog(botId, logType, message) {
  if (!db) {
    logError('[Error] Firebase not initialized');
    return;
  }
  try {
    const logsRef = ref(db, `bots/${botId}/logs`);
    await push(logsRef, {
      log_type: logType,
      message,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logError(`Failed to add bot log: ${err.message}`);
  }
}

// Send heartbeat every 10 secondsa
function startHeartbeat() {
  setInterval(async () => {
    const stats = getSystemStats();
    await updateNodeStatus({
      online: true,
      stats,
    });
  }, 10000);
  
  logInfo('Heartbeat started (10s interval)');
}

// Get system stats
function getSystemStats() {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  
  let totalIdle = 0, totalTick = 0;
  cpus.forEach((cpu) => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const cpuUsage = 100 - Math.floor((idle / total) * 100);
  
  return {
    cpu_usage: cpuUsage,
    ram_used: totalMemory - freeMemory,
    ram_total: totalMemory,
    bot_count: botClients.size,
  };
}

// Register node
async function registerNode() {
  if (!CONFIG.accessToken || CONFIG.accessToken === 'cn-your-token-here') {
    logError('ACCESS_TOKEN is required! Get it from: https://cakranode.vercel.app/dashboard/nodes');
    logError('Steps:');
    logError('1. Login as admin');
    logError('2. Go to Nodes page');
    logError('3. Click "Create Node"');
    logError('4. Copy the token and add to config.json: "accessToken": "cn-..."');
    process.exit(1);
  }
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/node/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: CONFIG.accessToken,
        ip_address: CONFIG.nodeIp,
      }),
    });
    
    const data = await response.json();
    if (data.success) {
      nodeId = data.node.id;
      logInfo(`Node registered: ${data.node.name} (${nodeId})`);
      return true;
    }
    logError(`Failed to register: ${data.error}`);
    return false;
  } catch (err) {
    logError(`Registration error: ${err.message}`);
    return false;
  }
}

// Process command
async function processCommand(command, commandId) {
  logInfo(`Processing: ${command.action} for bot ${command.bot_id || 'N/A'} (commandId: ${commandId})`);
  
  try {
    let result = {};
    
    switch (command.action) {
      case 'create':
      case 'start':
        result = await startBot(command);
        break;
      case 'stop':
        result = await stopBot(command);
        break;
      case 'restart':
        await stopBot(command);
        await new Promise(r => setTimeout(r, 2000));
        result = await startBot(command);
        break;
      case 'delete':
        result = await deleteBot(command);
        break;
      case 'exec':
        result = await execCommand(command);
        break;
      default:
        result = { error: `Unknown action: ${command.action}` };
    }
    
    // Update command result in Firebase
    const resultPath = `commands/${commandId}/result`;
    logInfo(`Saving command result to: ${resultPath}`);
    logInfo(`Result data:`, JSON.stringify(result, null, 2));
    
    await set(ref(db, resultPath), {
      status: result.error ? 'failed' : 'completed',
      result,
      timestamp: Date.now(),
    });
    
    logInfo(`Command result saved successfully`);
  } catch (err) {
    logError(`Command error: ${err.message}`);
    await set(ref(db, `commands/${commandId}/result`), {
      status: 'failed',
      result: { error: err.message },
      timestamp: Date.now(),
    });
  }
}

// Start bot
async function startBot(command) {
  const { bot_id, payload } = command;
  
  // Handle both old and new command formats
  if (!payload || !payload.username) {
    logWarn('Command missing payload, skipping (old command format)');
    return { error: 'Invalid command format - missing payload' };
  }
  
  const { username, server_ip, server_port, offline_mode } = payload;
  
  if (botClients.has(bot_id)) {
    return { message: 'Bot already running', username };
  }
  
  logInfo(`Starting: ${username} -> ${server_ip}:${server_port} (${offline_mode ? 'offline' : 'online'} mode)`);
  
  // Update status to starting
  await updateBotStatus(bot_id, 'starting');
  
  // Setup Xbox auth detection for online mode
  let authResolve = null;
  let authResolved = false;
  
  const waitForAuth = new Promise((resolve) => {
    authResolve = resolve;
  });
  
  // Intercept stdout to catch login code
  if (!offline_mode) {
    logInfo(`[${username}] Setting up Xbox auth detection...`);
    
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const loginCodeRegex = /code ([A-Z0-9]{8})/;
    
    process.stdout.write = function(chunk, encoding, callback) {
      const message = chunk.toString();
      
      // Check for login code
      if (!authResolved && loginCodeRegex.test(message)) {
        const codeMatch = message.match(loginCodeRegex);
        if (codeMatch) {
          const code = codeMatch[1];
          
          // Use original stdout to avoid loop
          originalStdoutWrite(`[${username}] ✓ Login code DETECTED: ${code}\n`);
          
          // Update bot status to authenticating
          updateBotStatus(bot_id, 'authenticating').catch(() => {});
          
          // Send to Firebase logs
          addBotLog(bot_id, 'info', `🔐 Xbox Login Required: https://www.microsoft.com/link - Code: ${code}`).catch(() => {});
          
          logInfo(`[${username}] Auth code detected: ${code}`);
          
          // Resolve with login info
          authResolved = true;
          authResolve({ needsAuth: true, code, link: 'https://www.microsoft.com/link' });
        }
      }
      
      return originalStdoutWrite(chunk, encoding, callback);
    };
    
    // Restore stdout after 40 seconds
    setTimeout(() => {
      process.stdout.write = originalStdoutWrite;
      if (!authResolved) {
        logInfo(`[${username}] No auth code detected after 40s, proceeding normally`);
        authResolved = true;
        authResolve({ needsAuth: false });
      }
    }, 40000);
  } else {
    logInfo(`[${username}] Offline mode - skipping Xbox auth`);
  }
  
  const clientOptions = {
    host: server_ip,
    port: server_port || 19132,
    username,
    offline: offline_mode !== false,
  };
  
  // Add proxy if available
  const proxy = proxyManager.getRandom();
  if (proxy) {
    clientOptions.proxy = {
      host: proxy.host,
      port: proxy.port,
      type: proxy.type,
    };
    logInfo(`Using proxy: ${proxy.host}:${proxy.port}`);
  }
  
  const client = bedrock.createClient(clientOptions);
  
  botClients.set(bot_id, {
    client,
    username,
    connected: false,
    server_ip,
    server_port,
    offline_mode,
  });
  
  // Connection timeout (30 seconds)
  const connectionTimeout = setTimeout(() => {
    if (!botClients.get(bot_id)?.connected) {
      logError(`[${username}] Connection timeout (30s) - trying different proxy`);
      if (client) client.close();
      botClients.delete(bot_id);
      
      // Retry with different proxy after 2 seconds
      setTimeout(() => {
        logInfo(`[${username}] Retrying connection...`);
        startBot(command).catch(err => {
          logError(`[${username}] Retry failed: ${err.message}`);
          updateBotStatus(bot_id, 'error', 'Connection failed after retry');
        });
      }, 2000);
    }
  }, 30000);
  
  // Handle connection errors
  client.on('error', (err) => {
    clearTimeout(connectionTimeout);
    logError(`[${username}] Connection error: ${err.message}`);
    updateBotStatus(bot_id, 'error', err.message);
    botClients.delete(bot_id);
  });
  
  client.on('spawn', () => {
    clearTimeout(connectionTimeout);
    logInfo(`[${username}] Spawned!`);
    const bot = botClients.get(bot_id);
    if (bot) bot.connected = true;
    updateBotStatus(bot_id, 'running');
    addBotLog(bot_id, 'info', 'Bot spawned successfully');
  });
  
  client.on('disconnect', (packet) => {
    clearTimeout(connectionTimeout);
    const reason = packet?.message || 'Unknown';
    logWarn(`[${username}] Disconnected: ${reason}`);
    updateBotStatus(bot_id, 'stopped', reason);
    botClients.delete(bot_id);
  });
  
  client.on('text', (packet) => {
    if (packet?.message) {
      const msg = packet.message.replace(/§[0-9a-zA-Z]/gi, '');
      logServer(`[${username}] ${msg}`);
      addBotLog(bot_id, 'server', msg);
    }
  });
  
  client.on('kick', (packet) => {
    clearTimeout(connectionTimeout);
    const reason = packet?.message || 'Kicked from server';
    logError(`[${username}] Kicked: ${reason}`);
    updateBotStatus(bot_id, 'error', reason);
    botClients.delete(bot_id);
  });
  
  client.on('close', () => {
    logWarn(`[${username}] Connection closed`);
  });
  
  // Wait for auth if online mode
  if (!offline_mode) {
    logInfo(`[${username}] Waiting for auth detection (40s timeout)...`);
    const authResult = await waitForAuth;
    
    logInfo(`[${username}] Auth detection complete: needsAuth=${authResult.needsAuth}`);
    
    if (authResult.needsAuth) {
      logInfo(`[${username}] Returning auth requirement to frontend...`);
      await addBotLog(bot_id, 'info', `⏳ Waiting for Xbox authentication - check console for login code`);
      
      return {
        message: 'Authentication required',
        username,
        auth: { code: authResult.code, link: authResult.link }
      };
    } else {
      logInfo(`[${username}] No auth required, bot will continue connecting...`);
    }
  }
  
  return { message: 'Bot started', username };
}

// Stop bot
async function stopBot(command) {
  const { bot_id } = command;
  const bot = botClients.get(bot_id);
  
  if (!bot) return { message: 'Bot not found' };
  
  logInfo(`Stopping: ${bot.username}`);
  if (bot.client) bot.client.close();
  botClients.delete(bot_id);
  
  updateBotStatus(bot_id, 'stopped');
  return { message: 'Bot stopped', username: bot.username };
}

// Delete bot
async function deleteBot(command) {
  const { bot_id } = command;
  
  // Stop bot if running
  const bot = botClients.get(bot_id);
  if (bot) {
    logInfo(`Stopping bot ${bot.username} before deletion...`);
    if (bot.client) bot.client.close();
    botClients.delete(bot_id);
  } else {
    logInfo(`Bot ${bot_id} not running, proceeding with deletion`);
  }
  
  // Update status to deleted in Firebase
  try {
    await updateBotStatus(bot_id, 'deleted');
    logInfo(`Bot ${bot_id} marked as deleted in Firebase`);
  } catch (err) {
    logError(`Failed to mark bot as deleted: ${err.message}`);
  }
  
  // Clean up bot logs (optional - keep for history)
  // await set(ref(db, `bots/${bot_id}/logs`), null);
  
  return { 
    message: 'Bot deleted successfully',
    username: bot?.username || 'Unknown'
  };
}

// Execute command on bot
async function execCommand(command) {
  const { bot_id, payload } = command;
  
  if (!payload || !payload.command) {
    return { error: 'Missing command in payload' };
  }
  
  const bot = botClients.get(bot_id);
  if (!bot || !bot.client) {
    return { error: 'Bot not found or not connected' };
  }
  
  try {
    // Ensure command starts with /
    const cmd = payload.command.startsWith('/') ? payload.command : `/${payload.command}`;
    
    // Send command using the same method as node-server.js
    bot.client.write('command_request', {
      command: cmd,
      origin: {
        type: 'player',
        uuid: '',
        request_id: '',
        player_entity_id: 0,
      },
      internal: false,
      version: '52',
    });
    
    logInfo(`[${bot.username}] Executed: ${cmd}`);
    addBotLog(bot_id, 'command', `Executed: ${cmd}`);
    
    return { 
      message: 'Command executed', 
      username: bot.username,
      command: cmd 
    };
  } catch (err) {
    logError(`[${bot.username}] Exec error: ${err.message}`);
    addBotLog(bot_id, 'error', `Command failed: ${err.message}`);
    return { error: err.message };
  }
}

// Main
async function main() {
  logInfo('=== CakraNode - Firebase Realtime Version ===');
  logInfo(`Proxy system: ${proxyManager.getCount()} proxies loaded`);
  
  const registered = await registerNode();
  if (!registered) {
    logError('Failed to register, retrying in 30s...');
    setTimeout(main, 30000);
    return;
  }
  
  logInfo('Node registered, initializing Firebase...');
  initFirebase();
  
  // Set node online
  await updateNodeStatus({ online: true, stats: getSystemStats() });
  
  // Start listening for commands
  listenForCommands();
  
  // Start heartbeat
  startHeartbeat();
  
  logInfo('Firebase node server running!');
}

main();
