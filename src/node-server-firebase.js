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
import { getDatabase, ref, set, push, onChildAdded, get, query, orderByChild, equalTo, update } from 'firebase/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config from JSON
let config;
try {
  const configPath = path.join(__dirname, '..', 'config.json');
  const configFile = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configFile);
} catch (error) {
  console.error('❌ Failed to load config.json:', error.message);
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
const processedCommands = new Set(); // Track processed command IDs
let nodeId = null;
let db = null;
let heartbeatTimer = null;
let lastCommandTime = 0;

// Smart Heartbeat Configuration
const HEARTBEAT_CONFIG = {
  idle: 60000,      // 60s when no bots running
  active: 15000,    // 15s with bots running
  burst: 5000,      // 5s after recent command
  burstDuration: 30000, // 30s burst mode duration
};

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
};

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

// Listen for commands in realtime from Firebase
function listenForCommands() {
  if (!db || !nodeId) {
    logError('[Cmd Listen] Cannot listen - Firebase or nodeId not ready');
    return;
  }

  // Query commands for this node that are pending
  const commandsRef = ref(db, 'commands');
  const nodeCommandsQuery = query(
    commandsRef,
    orderByChild('node_id'),
    equalTo(nodeId)
  );

  logInfo('[Cmd Listen] Listening for commands from Firebase RTDB...');

  // Listen for new commands
  onChildAdded(nodeCommandsQuery, async (snapshot) => {
    const commandId = snapshot.key;
    const command = snapshot.val();

    // Skip if already processed
    if (processedCommands.has(commandId)) {
      return;
    }

    // Only process pending commands
    if (command.status !== 'pending') {
      processedCommands.add(commandId);
      return;
    }

    logInfo(`[Cmd Listen] New command: ${command.action} for bot ${command.bot_id} (${commandId})`);
    
    // Mark as processed to avoid duplicates
    processedCommands.add(commandId);

    // Mark command as processing
    try {
      await update(ref(db, `commands/${commandId}`), {
        status: 'processing',
        processed_at: Date.now(),
      });
    } catch (err) {
      logError(`[Cmd Listen] Failed to mark command as processing: ${err.message}`);
    }

    // Process the command
    await processCommand(command, commandId);
  });
}

async function updateNodeStatus(data) {
  if (!nodeId) {
    logError('[Error] Node not registered yet');
    return;
  }

  try {
    // Send heartbeat to API endpoint
    const response = await fetch(`${CONFIG.apiUrl}/api/node/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: nodeId,
        secret_key: 'cn-12345678abcdefghij', // Must match NODE_SECRET_KEY in .env
        stats: data.stats || {},
      }),
    });

    const result = await response.json();
    if (!result.success) {
      logError(`Heartbeat failed: ${result.error}`);
    }
  } catch (err) {
    logError(`Failed to send heartbeat: ${err.message}`);
  }
}

async function updateBotStatus(botId, status, error = null) {
  if (!db) {
    logError('[Error] Firebase not initialized');
    return;
  }
  
  // Retry logic for Firebase writes
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      await set(ref(db, `bots/${botId}/status`), {
        status,
        error,
        timestamp: Date.now(),
      });
      return; // Success
    } catch (err) {
      logError(`Failed to update bot status (attempt ${attempt + 1}): ${err.message}`);
      
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.baseDelay * Math.pow(2, attempt)));
      }
    }
  }
}

async function addBotLog(botId, logType, message) {
  if (!db) {
    logError('[Error] Firebase not initialized');
    return;
  }
  
  // Single attempt for logs (not critical)
  try {
    // Do not write logs older than logs_cleared_at
    try {
      const clearedSnap = await get(ref(db, `bots/${botId}/logs_cleared_at`));
      const clearedAt = clearedSnap?.val?.() || clearedSnap?.val && clearedSnap.val();
      if (clearedAt) {
        const createdAt = new Date().toISOString();
        if (new Date(createdAt) <= new Date(clearedAt)) {
          logInfo(`[${botId}] Skipping log write because created_at <= logs_cleared_at (${createdAt} <= ${clearedAt})`);
          return;
        }
      }
    } catch (e) {
      // If we cannot read cleared timestamp, proceed to write log to avoid losing critical info
      logWarn(`[${botId}] Could not read logs_cleared_at before writing log: ${e.message}`);
    }

    const logsRef = ref(db, `bots/${botId}/logs`);
    await push(logsRef, {
      log_type: logType,
      message,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Just log error, don't retry for logs
    logError(`Failed to add bot log: ${err.message}`);
  }
}

// Get adaptive heartbeat interval based on bot activity
function getHeartbeatInterval() {
  const activeBots = Array.from(botClients.values())
    .filter(bot => bot.client?.status === 'online').length;
  
  // Burst mode: after recent command
  const timeSinceCommand = Date.now() - lastCommandTime;
  if (timeSinceCommand < HEARTBEAT_CONFIG.burstDuration) {
    return HEARTBEAT_CONFIG.burst;
  }
  
  // Active mode: bots are running
  if (activeBots > 0) {
    return HEARTBEAT_CONFIG.active;
  }
  
  // Idle mode: no bots
  return HEARTBEAT_CONFIG.idle;
}

// Smart heartbeat with adaptive interval
function startHeartbeat() {
  let currentInterval = HEARTBEAT_CONFIG.idle;
  
  const sendHeartbeat = async () => {
    const stats = getSystemStats();
    await updateNodeStatus({
      stats,
    });
    
    // Check if interval needs adjustment
    const newInterval = getHeartbeatInterval();
    if (newInterval !== currentInterval) {
      currentInterval = newInterval;
      logInfo(`Heartbeat interval adjusted to ${currentInterval}ms`);
      
      // Restart timer with new interval
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      heartbeatTimer = setInterval(sendHeartbeat, currentInterval);
    }
  };
  
  // Initial heartbeat
  sendHeartbeat();
  
  // Start timer
  heartbeatTimer = setInterval(sendHeartbeat, currentInterval);
  
  logInfo(`Smart heartbeat started (adaptive: ${HEARTBEAT_CONFIG.idle}ms idle, ${HEARTBEAT_CONFIG.active}ms active, ${HEARTBEAT_CONFIG.burst}ms burst)`);
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
  // Track command time for burst mode heartbeat
  lastCommandTime = Date.now();
  
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
    
    // Update command result in Firebase RTDB
    const status = result.error ? 'failed' : 'completed';
    logInfo(`[Cmd Process] Updating command ${commandId} status: ${status}`);
    
    try {
      await update(ref(db, `commands/${commandId}`), {
        status,
        result: result,
        completed_at: Date.now(),
      });
      logInfo(`[Cmd Process] Command ${commandId} marked as ${status}`);
    } catch (updateErr) {
      logError(`[Cmd Process] Failed to update command in Firebase: ${updateErr.message}`);
    }
  } catch (err) {
    logError(`[Cmd Process] Error: ${err.message}`);
    
    // Mark command as failed in Firebase
    try {
      await update(ref(db, `commands/${commandId}`), {
        status: 'failed',
        result: { error: err.message },
        completed_at: Date.now(),
      });
    } catch (updateErr) {
      logError(`[Cmd Process] Failed to update failed status: ${updateErr.message}`);
    }
  }
}

// Auto reconnect function
async function reconnectBot(bot_id, payload, retryCount = 0) {
  // Check if already reconnecting
  const existingBot = botClients.get(bot_id);
  if (existingBot && existingBot.reconnecting) {
    logInfo(`[${payload.username}] Already reconnecting, skipping duplicate call`);
    return;
  }
  
  const maxRetries = 999999; // Unlimited reconnect
  const delay = 5000; // Fixed 5 seconds delay
  
  if (retryCount >= maxRetries) {
    logError(`[${payload.username}] Max reconnect attempts reached (${maxRetries})`);
    await updateBotStatus(bot_id, 'error', 'Max reconnect attempts reached');
    return;
  }
  
  // Mark as reconnecting
  if (existingBot) {
    existingBot.reconnecting = true;
  }
  
  logInfo(`[${payload.username}] Reconnecting in ${delay/1000}s... (attempt ${retryCount + 1})`);
  await addBotLog(bot_id, 'info', `🔄 Reconnecting in ${delay/1000}s... (attempt ${retryCount + 1})`);
  
  setTimeout(() => {
    logInfo(`[${payload.username}] Attempting reconnect #${retryCount + 1}...`);
    startBot({ bot_id, payload, retryCount: retryCount + 1 }).catch(err => {
      logError(`[${payload.username}] Reconnect failed: ${err.message}`);
    });
  }, delay);
}

// Start bot
async function startBot(command) {
  const { bot_id, payload, retryCount = 0 } = command;
  
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
    version: '1.21.130',
  };
  
  logInfo(`[${username}] Connecting directly to ${server_ip}:${server_port}`);
  
  let client;
  try {
    client = bedrock.createClient(clientOptions);
  } catch (err) {
    logError(`[${username}] Failed to create client: ${err.message}`);
    await updateBotStatus(bot_id, 'error', `Failed to create client: ${err.message}`);
    return { error: err.message };
  }
  
  botClients.set(bot_id, {
    client,
    username,
    connected: false,
    server_ip,
    server_port,
    offline_mode,
    authResolve,  // Store for later use
    retryCount,   // Track reconnect attempts
    payload,      // Store original payload for reconnect
    reconnecting: false,  // Flag to prevent duplicate reconnects
  });
  
  // Connection timeout (60 seconds for online mode to allow auth time)
  const timeoutDuration = offline_mode ? 30000 : 60000;
  const connectionTimeout = setTimeout(() => {
    const bot = botClients.get(bot_id);
    if (bot && !bot.connected && !bot.manuallyStopped) {
      logError(`[${username}] Connection timeout (${timeoutDuration/1000}s)`);
      if (client) client.close();  // Will trigger 'close' event which handles reconnect
    }
  }, timeoutDuration);
  
  // Handle connection errors
  client.on('error', (err) => {
    clearTimeout(connectionTimeout);
    logError(`[${username}] Connection error: ${err.message}`);
    // Don't reconnect here - close event will handle it
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
    // Don't reconnect here - close event will handle it
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
    // Don't reconnect here - close event will handle it
  });
  
  client.on('close', () => {
    clearTimeout(connectionTimeout);
    const bot = botClients.get(bot_id);
    
    // Don't reconnect if manually stopped
    if (bot && bot.manuallyStopped) {
      logWarn(`[${username}] Connection closed (manual stop)`);
      botClients.delete(bot_id);
      return;
    }
    
    if (bot && bot.connected === false) {
      logError(`[${username}] Connection closed before spawn`);
      botClients.delete(bot_id);
      reconnectBot(bot_id, bot.payload, bot.retryCount);
    } else if (bot) {
      logWarn(`[${username}] Connection closed normally`);
      botClients.delete(bot_id);
      reconnectBot(bot_id, bot.payload, bot.retryCount);
    }
  });
  
  // For online mode, wait briefly for auth detection before returning
  if (!offline_mode) {
    logInfo(`[${username}] Waiting up to 15s for auth detection...`);
    
    // Wait up to 15 seconds for auth detection
    const authResult = await Promise.race([
      waitForAuth,
      new Promise(resolve => setTimeout(() => resolve({ needsAuth: false }), 15000))
    ]);
    
    if (authResult.needsAuth) {
      logInfo(`[${username}] Auth required! Returning code to frontend...`);
      await addBotLog(bot_id, 'info', `⏳ Waiting for Xbox authentication...`);
      
      return {
        message: 'Authentication required',
        username,
        auth: { code: authResult.code, link: authResult.link }
      };
    } else {
      logInfo(`[${username}] No auth detected in 15s, proceeding without auth...`);
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
  
  // Prevent force-stop while bot is still starting (not connected)
  if (bot.connected === false) {
    logWarn(`[${bot.username}] Stop requested while bot is starting; rejecting force-stop`);
    return { error: 'Cannot stop while bot is starting' };
  }

  // Mark as manually stopped to prevent auto-reconnect
  bot.manuallyStopped = true;
  
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
    
    // Mark as manually stopped to prevent reconnect
    bot.manuallyStopped = true;
    
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
  
  const registered = await registerNode();
  if (!registered) {
    logError('Failed to register, retrying in 30s...');
    setTimeout(main, 30000);
    return;
  }
  
  logInfo('Node registered, initializing Firebase...');
  initFirebase();
  
  // Send initial heartbeat to set node online
  await updateNodeStatus({ stats: getSystemStats() });
  
  // Start listening for commands from Firebase RTDB
  listenForCommands();
  
  // Start heartbeat
  startHeartbeat();
  
  logInfo('Node server running with Firebase Realtime Database!');
}

main();
