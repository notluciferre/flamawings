/**
 * CakraNode - Bot Node Server (WebSocket Version)
 * Real-time communication using native WebSocket
 */

import os from 'os';
import bedrock from 'bedrock-protocol';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

// Configuration
const CONFIG = {
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  wsUrl: process.env.WS_URL || 'ws://localhost:3000',
  nodeSecretKey: process.env.NODE_SECRET_KEY || 'cn-12345678abcdefghij',
  nodeName: process.env.NODE_NAME || 'Local-node',
  nodeLocation: process.env.NODE_LOCATION || 'Unknown',
  nodeIp: process.env.NODE_IP || 'auto',
  proxyHost: process.env.PROXY_HOST || null,
  proxyPort: process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT) : null,
  proxyUsername: process.env.PROXY_USERNAME || null,
  proxyPassword: process.env.PROXY_PASSWORD || null,
};

const botClients = new Map();
let nodeId = null;
let ws = null;
let reconnectTimer = null;

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

// WebSocket Connection
function connectWebSocket() {
  const wsUrl = `${CONFIG.wsUrl}/api/ws/node?node_id=${nodeId}&secret_key=${CONFIG.nodeSecretKey}`;
  
  logInfo(`Connecting to WebSocket: ${wsUrl}`);
  ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    logInfo('WebSocket connected!');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(message);
    } catch (err) {
      logError(`Failed to parse message: ${err.message}`);
    }
  });
  
  ws.on('error', (err) => {
    logError(`WebSocket error: ${err.message}`);
  });
  
  ws.on('close', () => {
    logWarn('WebSocket disconnected, reconnecting in 5s...');
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  });
}

// Send message via WebSocket
function sendWS(type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// Handle incoming messages
async function handleMessage(message) {
  const { type, data } = message;
  
  switch (type) {
    case 'command':
      await processCommand(data);
      break;
    case 'heartbeat_request':
      sendWS('heartbeat_response', { stats: getSystemStats() });
      break;
    default:
      logWarn(`Unknown message type: ${type}`);
  }
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
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/node/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: CONFIG.nodeName,
        location: CONFIG.nodeLocation,
        ip_address: CONFIG.nodeIp === 'auto' ? 'localhost' : CONFIG.nodeIp,
        secret_key: CONFIG.nodeSecretKey,
      }),
    });
    
    const data = await response.json();
    if (data.success) {
      nodeId = data.node.id;
      logInfo(`Node registered: ${nodeId}`);
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
async function processCommand(command) {
  logInfo(`Processing: ${command.action} for bot ${command.bot_id || 'N/A'}`);
  
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
      default:
        result = { error: `Unknown action: ${command.action}` };
    }
    
    sendWS('command_result', {
      command_id: command.id,
      status: result.error ? 'failed' : 'completed',
      result,
    });
  } catch (err) {
    logError(`Command error: ${err.message}`);
    sendWS('command_result', {
      command_id: command.id,
      status: 'failed',
      result: { error: err.message },
    });
  }
}

// Start bot
async function startBot(command) {
  const { bot_id, payload } = command;
  const { username, server_ip, server_port, offline_mode } = payload;
  
  if (botClients.has(bot_id)) {
    return { message: 'Bot already running', username };
  }
  
  logInfo(`Starting: ${username} -> ${server_ip}:${server_port}`);
  
  const clientOptions = {
    host: server_ip,
    port: server_port || 19132,
    username,
    offline: offline_mode !== false,
  };
  
  const client = bedrock.createClient(clientOptions);
  
  botClients.set(bot_id, {
    client,
    username,
    connected: false,
  });
  
  client.on('spawn', () => {
    logInfo(`[${username}] Spawned!`);
    const bot = botClients.get(bot_id);
    if (bot) bot.connected = true;
    sendWS('bot_status', { bot_id, status: 'running' });
  });
  
  client.on('disconnect', (packet) => {
    logWarn(`[${username}] Disconnected: ${packet?.message || 'Unknown'}`);
    sendWS('bot_status', { bot_id, status: 'error', error: packet?.message });
  });
  
  client.on('text', (packet) => {
    if (packet?.message) {
      const msg = packet.message.replace(/§[0-9a-zA-Z]/gi, '');
      logServer(`[${username}] ${msg}`);
      sendWS('bot_log', { bot_id, log_type: 'server', message: msg });
    }
  });
  
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
  
  sendWS('bot_status', { bot_id, status: 'stopped' });
  return { message: 'Bot stopped', username: bot.username };
}

// Main
async function main() {
  logInfo('=== CakraNode - WebSocket Version ===');
  
  const registered = await registerNode();
  if (!registered) {
    logError('Failed to register, retrying in 30s...');
    setTimeout(main, 30000);
    return;
  }
  
  logInfo('Node registered, connecting to WebSocket...');
  connectWebSocket();
}

main();
