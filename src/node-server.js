/**
 * CakraNode - Bedrock Bot Node Server
 * This server polls the CakraNode web API for commands and manages multiple bots
 */

import fs from 'fs';
import os from 'os';
import bedrock from 'bedrock-protocol';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const CONFIG = {
  // API Configuration
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  nodeSecretKey: process.env.NODE_SECRET_KEY || 'cn-12345678abcdefghij',
  pollInterval: parseInt(process.env.POLL_INTERVAL) || 3000,
  
  // Node Information
  nodeName: process.env.NODE_NAME || 'Local-node',
  nodeLocation: process.env.NODE_LOCATION || 'Unknown',
  nodeIp: process.env.NODE_IP || 'auto',
  
  // Log Configuration
  logBatchInterval: parseInt(process.env.LOG_BATCH_INTERVAL) || 1000,
  logBatchSize: parseInt(process.env.LOG_BATCH_SIZE) || 50,
};

// Bot clients management - Map of bot_id -> bot instance
const botClients = new Map();

// Node state
let nodeId = null;
let isRunning = true;

// Optimization: Log batching
const logBatchQueue = new Map(); // bot_id -> array of logs

// Optimization: Status cache to prevent duplicate updates
const lastBotStatus = new Map(); // bot_id -> last status

// Optimization: Debounce status updates
const statusUpdateTimers = new Map(); // bot_id -> timer

// Logger functions
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function log(level, message) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] [${level}]: ${message}`);
}

function logServer(message) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] [SERVER]: ${message}`);
}

function logInfo(message) {
  log('INFO', message);
}

function logWarn(message) {
  log('WARN', message);
}

function logError(message) {
  log('ERROR', message);
}

// Update bot status in database (with debouncing and caching)
async function updateBotStatus(botId, status, error = null) {
  // Check if status changed
  const lastStatus = lastBotStatus.get(botId);
  if (lastStatus === status && !error) {
    return; // Skip if status unchanged
  }
  
  // Clear existing timer
  if (statusUpdateTimers.has(botId)) {
    clearTimeout(statusUpdateTimers.get(botId));
  }
  
  // Debounce: wait 500ms before sending
  const timer = setTimeout(async () => {
    try {
      logInfo(`Updating bot ${botId} status to: ${status}`);
      
      const response = await fetch(`${CONFIG.apiUrl}/api/bots/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bot_id: botId,
          secret_key: CONFIG.nodeSecretKey,
          status,
          error,
        }),
      });
      
      const data = await response.json();
      
      if (!data.success) {
        logError(`Failed to update bot status: ${data.error}`);
      } else {
        lastBotStatus.set(botId, status);
        logInfo(`Bot status updated successfully: ${botId} -> ${status}`);
      }
    } catch (err) {
      logError(`Failed to update bot status: ${err.message}`);
    }
    
    statusUpdateTimers.delete(botId);
  }, 500);
  
  statusUpdateTimers.set(botId, timer);
}

// Strip Minecraft color codes
function stripMinecraftColors(text) {
  return text.replace(/§[0-9a-zA-Z]/gi, '');
}

// Send log to API (with batching)
async function sendLogToApi(botId, logType, message, metadata = {}) {
  // Add to batch queue
  if (!logBatchQueue.has(botId)) {
    logBatchQueue.set(botId, []);
  }
  
  logBatchQueue.get(botId).push({
    log_type: logType,
    message,
    metadata,
    timestamp: new Date().toISOString(),
  });
  
  // Send immediately if batch size exceeded
  if (logBatchQueue.get(botId).length >= CONFIG.logBatchSize) {
    await flushLogBatch(botId);
  }
}

// Flush log batch for a specific bot
async function flushLogBatch(botId) {
  const logs = logBatchQueue.get(botId);
  if (!logs || logs.length === 0) return;
  
  // Clear queue immediately to prevent duplicates
  logBatchQueue.set(botId, []);
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/bots/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: botId,
        logs: logs, // Send array of logs
        secret_key: CONFIG.nodeSecretKey,
      }),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      logError(`Failed to send log batch to API: ${data.error}`);
      // Re-add logs to queue on failure
      logBatchQueue.get(botId).push(...logs);
    }
  } catch (err) {
    logError(`Failed to send log batch to API: ${err.message}`);
    // Re-add logs to queue on failure
    logBatchQueue.get(botId).push(...logs);
  }
}

// Flush all log batches
async function flushAllLogBatches() {
  const promises = [];
  for (const botId of logBatchQueue.keys()) {
    promises.push(flushLogBatch(botId));
  }
  await Promise.all(promises);
}

// Get system stats
function getSystemStats() {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  
  // Calculate CPU usage (simple average)
  let totalIdle = 0;
  let totalTick = 0;
  
  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const cpuUsage = 100 - Math.floor((idle / total) * 100);
  
  return {
    cpu_usage: cpuUsage,
    ram_used: totalMemory - freeMemory,
    ram_total: totalMemory,
    disk_used: 0, // TODO: Implement disk usage
    disk_total: 0,
    network_upload: 0,
    network_download: 0,
    bot_count: botClients.size,
  };
}

// Register node with API
async function registerNode() {
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/node/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
      logInfo(`Node registered successfully: ${nodeId}`);
      return true;
    } else {
      logError(`Failed to register node: ${data.error}`);
      return false;
    }
  } catch (error) {
    logError(`Node registration error: ${error.message}`);
    return false;
  }
}

// Send heartbeat to API
async function sendHeartbeat() {
  if (!nodeId) return;
  
  try {
    const stats = getSystemStats();
    
    const response = await fetch(`${CONFIG.apiUrl}/api/node/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        node_id: nodeId,
        secret_key: CONFIG.nodeSecretKey,
        stats,
      }),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      logWarn(`Heartbeat failed: ${data.error}`);
    }
  } catch (error) {
    logError(`Heartbeat error: ${error.message}`);
  }
}

// Poll for commands (optimized)
async function pollCommands() {
  if (!nodeId) return;
  
  // Skip polling if no bots running
  if (botClients.size === 0) {
    return;
  }
  
  try {
    const response = await fetch(
      `${CONFIG.apiUrl}/api/commands/poll?node_id=${nodeId}&secret_key=${CONFIG.nodeSecretKey}`
    );
    
    const data = await response.json();
    
    if (data.success && data.commands.length > 0) {
      logInfo(`Received ${data.commands.length} command(s)`);
      
      // Process commands in parallel for faster execution
      await Promise.all(data.commands.map(command => processCommand(command)));
    }
  } catch (error) {
    logError(`Poll commands error: ${error.message}`);
  }
}

// Process a single command
async function processCommand(command) {
  logInfo(`Processing command: ${command.action} for bot ${command.bot_id || 'N/A'}`);
  
  try {
    let result = {};
    let error = null;
    let status = 'completed';
    
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
        await new Promise((resolve) => setTimeout(resolve, 2000));
        result = await startBot(command);
        break;
      case 'exec':
        result = await execBotCommand(command);
        break;
      case 'delete':
        result = await deleteBot(command);
        break;
      default:
        error = `Unknown action: ${command.action}`;
        status = 'failed';
    }
    
    // Update command status
    await updateCommandStatus(command.id, status, result, error);
  } catch (err) {
    logError(`Command processing error: ${err.message}`);
    await updateCommandStatus(command.id, 'failed', {}, err.message);
  }
}

// Update command status
async function updateCommandStatus(commandId, status, result, error) {
  try {
    await fetch(`${CONFIG.apiUrl}/api/commands/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command_id: commandId,
        secret_key: CONFIG.nodeSecretKey,
        status,
        result,
        error,
      }),
    });
  } catch (err) {
    logError(`Failed to update command status: ${err.message}`);
  }
}

// Start a bot
async function startBot(command) {
  const { bot_id, payload } = command;
  const { username, server_ip, server_port, auto_reconnect, offline_mode } = payload;
  
  // Check if bot already exists
  if (botClients.has(bot_id)) {
    logWarn(`Bot ${bot_id} (${username}) already running`);
    return { message: 'Bot already running' };
  }
  
  try {
    logInfo(`Starting bot: ${username} -> ${server_ip}:${server_port} (${offline_mode ? 'offline' : 'online'} mode)`);
    
    let authResolve = null;
    let authResolved = false;
    
    // Promise to wait for login link
    const waitForAuth = new Promise((resolve) => {
      authResolve = resolve;
    });
    
    // Intercept stdout to catch login links
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
          
          // Send to web console
          sendLogToApi(bot_id, 'info', `🔐 Xbox Login Required: https://www.microsoft.com/link - Code: ${code}`).catch(() => {});
          
          // Resolve with login info
          authResolved = true;
          authResolve({ needsAuth: true, code, link: 'https://www.microsoft.com/link' });
        }
      }
      
      // Call original stdout.write
      return originalStdoutWrite(chunk, encoding, callback);
    };
    
    // Restore stdout after 20 seconds
    setTimeout(() => {
      process.stdout.write = originalStdoutWrite;
      if (!authResolved) {
        authResolved = true;
        authResolve({ needsAuth: false });
      }
    }, 20000);
    
    const clientOptions = {
      host: server_ip,
      port: server_port || 19132,
      username: username,
      offline: offline_mode !== false, // Default true if not specified
    };
    
    const client = bedrock.createClient(clientOptions);
    
    // Store bot instance
    botClients.set(bot_id, {
      client,
      username,
      server_ip,
      server_port,
      auto_reconnect,
      offline_mode,
      connected: false,
      lastActivity: Date.now(),
      authPromise: waitForAuth,
    });
    
    // Setup event handlers
    setupBotHandlers(bot_id, client);
    
    // Wait for auth if online mode
    if (!offline_mode) {
      logInfo(`[${username}] Waiting for auth...`);
      const authResult = await waitForAuth;
      
      logInfo(`[${username}] Auth result: ${JSON.stringify(authResult)}`);
      
      if (authResult.needsAuth) {
        return { 
          message: 'Authentication required', 
          username,
          auth: { code: authResult.code, link: authResult.link }
        };
      }
    }
    
    return { message: 'Bot started successfully', username };
  } catch (error) {
    logError(`Failed to start bot ${username}: ${error.message}`);
    throw error;
  }
}

// Stop a bot
async function stopBot(command) {
  const { bot_id } = command;
  
  const bot = botClients.get(bot_id);
  if (!bot) {
    logWarn(`Bot ${bot_id} not found`);
    return { message: 'Bot not found' };
  }
  
  try {
    logInfo(`Stopping bot: ${bot.username}`);
    
    if (bot.client) {
      bot.client.close();
    }
    
    botClients.delete(bot_id);
    
    // Update status to stopped
    await updateBotStatus(bot_id, 'stopped');
    
    return { message: 'Bot stopped successfully', username: bot.username };
  } catch (error) {
    logError(`Failed to stop bot: ${error.message}`);
    throw error;
  }
}

// Execute command on bot
async function execBotCommand(command) {
  const { bot_id, payload } = command;
  const { command: cmd } = payload;
  
  const bot = botClients.get(bot_id);
  if (!bot) {
    throw new Error('Bot not found');
  }
  
  if (!bot.connected) {
    throw new Error('Bot not connected');
  }
  
  try {
    const commandStr = cmd.startsWith('/') ? cmd : `/${cmd}`;
    
    bot.client.write('command_request', {
      command: commandStr,
      origin: {
        type: 'player',
        uuid: '',
        request_id: '',
        player_entity_id: 0,
      },
      internal: false,
      version: '52',
    });
    
    logInfo(`Executed command on ${bot.username}: ${commandStr}`);
    return { message: 'Command executed', command: cmd };
  } catch (error) {
    logError(`Failed to execute command: ${error.message}`);
    throw error;
  }
}

// Delete bot
async function deleteBot(command) {
  const { bot_id } = command;
  
  // Stop bot if it's running
  const bot = botClients.get(bot_id);
  if (bot) {
    await stopBot(command);
  } else {
    logInfo(`Bot ${bot_id} not running, proceeding with deletion`);
  }
  
  // Delete bot from database
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/bots/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id,
        secret_key: CONFIG.nodeSecretKey,
      }),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      logError(`Failed to delete bot from database: ${data.error}`);
    } else {
      logInfo(`Bot ${bot_id} deleted from database`);
    }
  } catch (err) {
    logError(`Error deleting bot from database: ${err.message}`);
  }
  
  return { message: 'Bot deleted successfully' };
}

// Setup bot event handlers
function setupBotHandlers(botId, client) {
  const bot = botClients.get(botId);
  if (!bot) return;
  
  client.on('spawn', () => {
    logInfo(`[${bot.username}] Spawned in game`);
    bot.connected = true;
    bot.lastActivity = Date.now();
    
    // Update status to running
    updateBotStatus(botId, 'running');
  });
  
  client.on('disconnect', (packet) => {
    const reason = packet?.message || 'Unknown reason';
    logWarn(`[${bot.username}] Disconnected: ${reason}`);
    bot.connected = false;
    
    // Update status to error if disconnected
    updateBotStatus(botId, 'error', reason);
    
    // Auto-reconnect if enabled
    if (bot.auto_reconnect && botClients.has(botId)) {
      logInfo(`[${bot.username}] Auto-reconnecting in 15 seconds...`);
      setTimeout(() => {
        if (botClients.has(botId)) {
          // Recreate client
          const newClient = bedrock.createClient({
            host: bot.server_ip,
            port: bot.server_port,
            username: bot.username,
            offline: bot.offline_mode !== false,
          });
          
          bot.client = newClient;
          setupBotHandlers(botId, newClient);
        }
      }, 15000);
    }
  });
  
  client.on('text', (packet) => {
    if (packet?.message) {
      const cleanMsg = stripMinecraftColors(packet.message);
      logServer(`[${bot.username}] ${cleanMsg}`);
      
      // Send to web console
      sendLogToApi(botId, 'server', cleanMsg);
      
      bot.lastActivity = Date.now();
    }
    
    // Show all text packet data (for debugging login links)
    if (packet?.type === "translation" && packet?.parameters) {
      logInfo(`[${bot.username}] Translation: ${JSON.stringify(packet.parameters)}`);
    }
  });
  
  // Handle server settings packet (may contain auth info)
  client.on('server_settings_response', (packet) => {
    logInfo(`[${bot.username}] Server settings: ${JSON.stringify(packet)}`);
  });
  
  // Handle modal form (may contain login link)
  client.on('modal_form_request', (packet) => {
    logInfo(`[${bot.username}] Modal form: ${JSON.stringify(packet)}`);
  });
  
  client.on('error', (error) => {
    logError(`[${bot.username}] Error: ${error.message}`);
  });
}

// Main loop
async function mainLoop() {
  // Register node
  const registered = await registerNode();
  if (!registered) {
    logError('Failed to register node, retrying in 30 seconds...');
    setTimeout(() => {
      if (isRunning) mainLoop();
    }, 30000);
    return;
  }
  
  logInfo('Node started successfully');
  logInfo(`Polling interval: ${CONFIG.pollInterval}ms`);
  logInfo(`API URL: ${CONFIG.apiUrl}`);
  logInfo(`Log batch interval: ${CONFIG.logBatchInterval}ms`);
  logInfo(`Log batch size: ${CONFIG.logBatchSize}`);
  logInfo(`Node name: ${CONFIG.nodeName}`);
  logInfo(`Node location: ${CONFIG.nodeLocation}`);
  
  // Log batch flushing interval
  setInterval(async () => {
    if (!isRunning) return;
    await flushAllLogBatches();
  }, CONFIG.logBatchInterval);
  
  // Main polling loop (faster for commands)
  setInterval(async () => {
    if (!isRunning) return;
    
    await pollCommands();
  }, CONFIG.pollInterval);
  
  // Heartbeat loop (slower, every 10 seconds)
  setInterval(async () => {
    if (!isRunning) return;
    
    await sendHeartbeat();
  }, 10000);
  
  // Initial poll
  await pollCommands();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logInfo('Shutting down...');
  isRunning = false;
  
  // Flush remaining logs before shutdown
  await flushAllLogBatches();
  
  // Close all bot connections
  for (const [botId, bot] of botClients.entries()) {
    if (bot.client) {
      bot.client.close();
    }
  }
  
  process.exit(0);
});

// Start the node
logInfo('=== CakraNode - Bot Node Server ===');
mainLoop();
