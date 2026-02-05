/**
 * SIMPLE BEDROCK CLIENT
 * Commands: connect, disconnect, exec <command>
 */

import fs from "fs";
import readline from "readline";
import bedrock from "bedrock-protocol";

// Load config
const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));

// Load bots database
let botsDatabase = [];
try {
    botsDatabase = JSON.parse(fs.readFileSync("./bots.json", "utf8"));
} catch (err) {
    console.error("Failed to load bots.json, creating default...");
    botsDatabase = [{ username: "rexusgeming", enabled: true }];
    fs.writeFileSync("./bots.json", JSON.stringify(botsDatabase, null, 2));
}

// Bot clients management - Map of username -> bot state
const botClients = new Map();

let rl = null;
let gameInvoiceCounter = 0; // Counter for game invoices

// Bet limits (in dollars)
const MIN_BET = 100;    // $100 minimum
const MAX_BET = 10000;  // $10K maximum

// Game settings - Player win rate percentage (unfair game)
const PLAYER_WIN_RATE = 0; // 45% chance player wins, 55% chance host wins

// Convert bet string to number (handle K, M suffixes)
function parseBetAmount(betStr) {
    const match = betStr.match(/^([0-9.]+)([KMkm]?)$/);
    if (!match) return 0;
    
    let amount = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    
    if (suffix === 'K') amount *= 1000;
    else if (suffix === 'M') amount *= 1000000;
    
    return amount;
}

// Blackjack game logic
function playBlackjack(username, betAmount, botUsername) {
    // Parse and validate bet amount
    const betValue = parseBetAmount(betAmount);
    
    // Check if bet is within limits
    if (betValue < MIN_BET || betValue > MAX_BET) {
        const minDisplay = MIN_BET >= 1000 ? `$${MIN_BET/1000}K` : `$${MIN_BET}`;
        const maxDisplay = MAX_BET >= 1000 ? `$${MAX_BET/1000}K` : `$${MAX_BET}`;
        
        // Generate invalid invoice ID
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        gameInvoiceCounter++;
        
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const codeLength = Math.floor(Math.random() * 8) + 8;
        let randomCode = '';
        for (let i = 0; i < codeLength; i++) {
            randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const invalidId = `${dateStr}${randomCode}${gameInvoiceCounter}`;
        
        execCommandForBot(botUsername, `msg ${username} Bet tidak valid! Minimum: ${minDisplay}, Maximum: ${maxDisplay} #invalid${invalidId}`);
        logWarn(`[${botUsername}] Invalid bet from ${username}: $${betAmount} (min: ${minDisplay}, max: ${maxDisplay}) #invalid${invalidId}`);
        
        // Refund the player
        setTimeout(() => {
            execCommandForBot(botUsername, `pay ${username} ${betAmount}`);
            logInfo(`[${botUsername}] Refunded ${username} $${betAmount}`);
        }, 500);
        
        return;
    }
    
    // Unfair game logic - determine winner based on win rate percentage
    const randomChance = Math.random() * 100; // 0-100
    let playerWins = randomChance < PLAYER_WIN_RATE;
    
    // Generate numbers based on predetermined outcome
    let hostNumber, playerNumber;
    
    if (playerWins) {
        // Player should win - generate higher number for player
        playerNumber = Math.floor(Math.random() * 10) + 12; // 12-21
        hostNumber = Math.floor(Math.random() * 11) + 1;     // 1-11
    } else {
        // Host should win - generate higher number for host
        hostNumber = Math.floor(Math.random() * 10) + 12;   // 12-21
        playerNumber = Math.floor(Math.random() * 11) + 1;   // 1-11
    }
    
    // Generate invoice ID with alphanumeric code
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    gameInvoiceCounter++;
    
    // Generate random alphanumeric code with variable length (8-15 characters)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const codeLength = Math.floor(Math.random() * 8) + 8; // Random length between 8-15
    let randomCode = '';
    for (let i = 0; i < codeLength; i++) {
        randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const invoiceId = `${dateStr}${randomCode}${gameInvoiceCounter}`;
    
    let result = '';
    let shouldPayPlayer = false;
    
    // Determine winner (higher number wins, tie = host wins)
    if (playerNumber > hostNumber) {
        result = 'MENANG';
        shouldPayPlayer = true;
    } else if (playerNumber < hostNumber) {
        result = 'KALAH';
    } else {
        // Tie = host wins (should rarely happen with current logic)
        result = 'SERI (Host Menang)';
    }
    
    // Send result message
    const message = `${result}! Host: ${hostNumber} | Player: ${playerNumber} #invoice${invoiceId}`;
    execCommandForBot(botUsername, `msg ${username} ${message}`);
    logInfo(`[${botUsername}] Blackjack vs ${username}: ${message}`);
    
    // Pay player if they won (double the bet)
    if (shouldPayPlayer) {
        setTimeout(() => {
            // Calculate double bet (handle K, M suffixes)
            let payAmount = betAmount;
            const match = betAmount.match(/^([0-9.]+)([KMkm]?)$/);
            if (match) {
                const num = parseFloat(match[1]) * 2;
                const suffix = match[2] || '';
                payAmount = num + suffix;
            }
            
            execCommandForBot(botUsername, `pay ${username} ${payAmount}`);
            logInfo(`[${botUsername}] Paid ${username} $${payAmount} (2x bet)`);
        }, 500);
    }
}

// Logger functions
function getTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function log(level, message) {
    if (rl) {
        // Clear current line and move cursor to start
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
    }
    
    const timestamp = getTimestamp();
    console.log(`[${timestamp}] [${level}]: ${message}`);
    
    if (rl) {
        // Redraw prompt without newline
        process.stdout.write('> ');
    }
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

function logServer(message) {
    log('SERVER', message);
}

function logPing(message) {
    log('PING', message);
}

// Strip Minecraft color codes
function stripMinecraftColors(text) {
    return text.replace(/§[0-9a-zA-Z]/gi, '');
}

// Ping timeout checker with auto-reconnect for a specific bot
function startPingMonitor(username) {
    const botState = botClients.get(username);
    if (!botState) return;
    
    if (botState.pingInterval) {
        clearInterval(botState.pingInterval);
    }

    // Reset ping times
    botState.lastPingTime = Date.now();
    botState.lastPongTime = Date.now();

    botState.pingInterval = setInterval(() => {
        const bot = botClients.get(username);
        if (!bot || !bot.connected || !bot.client) return;

        const now = Date.now();
        const timeSinceLastPong = now - bot.lastPongTime;

        // Check if server is not responding
        if (timeSinceLastPong > config.ping.timeoutMs) {
            logWarn(`[${username}] Timeout detected (${timeSinceLastPong}ms since last response)`);
            
            if (bot.autoReconnectEnabled && config.ping.autoReconnect) {
                logInfo(`[${username}] Auto-reconnect triggered`);
                bot.reconnecting = true;
                disconnectBot(username);
                
                setTimeout(() => {
                    logInfo(`[${username}] Attempting to reconnect...`);
                    connectBot(username);
                }, config.ping.reconnectDelayMs || 3000);
            } else {
                disconnectBot(username);
            }
            return;
        }

        // Send ping command
        const pingCmd = config.ping.command || "ping";
        bot.lastAutoPingTime = Date.now();
        execCommandForBot(username, pingCmd, true);
        bot.lastPingTime = now;

    }, config.ping.intervalMs);
}

function stopPingMonitor(username) {
    const botState = botClients.get(username);
    if (botState && botState.pingInterval) {
        clearInterval(botState.pingInterval);
        botState.pingInterval = null;
    }
}

async function connectBot(username) {
    if (botClients.has(username) && botClients.get(username).connected) {
        logWarn(`[${username}] Already connected`);
        return;
    }
 
    try {
        logInfo(`[${username}] Connecting to ${config.server.ip}:${config.server.port}...`);

        const options = {
            host: config.server.ip,
            port: config.server.port,
            username: username,
            offline: false,  // Set to false for Xbox authentication
            skipPing: true,
            keepAlive: true,
        };

        const client = bedrock.createClient(options);
        
        // Initialize bot state
        const botState = {
            client: client,
            connected: false,
            pingInterval: null,
            lastPingTime: null,
            lastPongTime: null,
            autoReconnectEnabled: false,
            reconnecting: false,
            lastAutoPingTime: 0
        };
        
        botClients.set(username, botState);

        // Connection handlers
        client.on("spawn", () => {
            const bot = botClients.get(username);
            if (!bot) return;
            
            bot.connected = true;
            bot.lastPingTime = Date.now();
            bot.lastPongTime = Date.now();
            
            if (bot.reconnecting) {
                logInfo(`[${username}] ✓ Reconnected successfully!`);
                bot.reconnecting = false;
            } else {
                logInfo(`[${username}] ✓ Connected!`);
            }
            
            // Enable auto-reconnect after first successful connect
            bot.autoReconnectEnabled = true;
            startPingMonitor(username);
        });

        client.on("text", (packet) => {
            const bot = botClients.get(username);
            if (!bot) return;
            
            if (packet?.message) {
                const msg = packet.message.toLowerCase();
                const cleanMsg = stripMinecraftColors(packet.message);

                if (msg.includes("your ping is")) {
                    const now = Date.now();
                    if (now - bot.lastAutoPingTime < 2000) {
                        // This is auto-ping response, skip it
                        bot.lastPongTime = Date.now();
                        return;
                    }
                    // This is manual ping, show it
                    logServer(`[${username}] ${cleanMsg}`);
                    bot.lastPongTime = Date.now();
                    return;
                }
                
                // Check for payment (blackjack trigger)
                // Format: "username paid you $amount" or "username paid you $XK" or "username paid you $XM"
                const paymentMatch = cleanMsg.match(/^([\w.]+) paid you \$([0-9.]+[KMk]?)\.?$/i);
                if (paymentMatch) {
                    const playerUsername = paymentMatch[1];
                    const amountStr = paymentMatch[2];
                    
                    logServer(`[${username}] ${cleanMsg}`);
                    logInfo(`[${username}] 🎰 Blackjack game started with ${playerUsername} (bet: $${amountStr})`);
                    
                    // Play blackjack after a short delay
                    setTimeout(() => {
                        playBlackjack(playerUsername, amountStr, username);
                    }, 1000);
                    
                    bot.lastPongTime = Date.now();
                    return;
                }
                
                logServer(`[${username}] ${cleanMsg}`);
                
                // Update last pong time when we receive any text message
                bot.lastPongTime = Date.now();
            }
            
            // Show all text packet data (for debugging login links)
            if (packet?.type === "translation" && packet?.parameters) {
                logInfo(`[${username}] Translation: ${JSON.stringify(packet.parameters)}`);
            }
        });
        
        // Handle server settings packet (may contain auth info)
        client.on("server_settings_response", (packet) => {
            logInfo(`[${username}] Server settings: ${JSON.stringify(packet)}`);
        });
        
        // Handle modal form (may contain login link)
        client.on("modal_form_request", (packet) => {
            logInfo(`[${username}] Modal form: ${JSON.stringify(packet)}`);
        });

        client.on("disconnect", (packet) => {
            const msg = packet?.message || "Connection closed";
            logWarn(`[${username}] Disconnected: ${stripMinecraftColors(msg)}`);
            handleBotDisconnect(username, msg);
        });

        client.on("kick", (packet) => {
            const msg = packet?.message || "Kicked from server";
            logError(`[${username}] Kicked: ${stripMinecraftColors(msg)}`);
            handleBotDisconnect(username, msg);
        });

        client.on("close", () => {
            logWarn(`[${username}] Connection closed`);
            handleBotDisconnect(username);
        });

        client.on("error", (err) => {
            const msg = String(err?.message || err);
            // Ignore harmless decode errors
            if (msg.includes('Read error') || msg.includes('Invalid tag')) {
                return;
            }
            logError(`[${username}] ${msg}`);
        });

        // Auto-respawn on death
        client.on("respawn", (packet) => {
            const bot = botClients.get(username);
            if (!bot) return;
            
            logInfo(`[${username}] Respawned`);
            bot.lastPongTime = Date.now();
        });

        client.on("set_health", (packet) => {
            const bot = botClients.get(username);
            if (!bot) return;
            
            // Check if bot died (health = 0)
            if (packet.health <= 0) {
                logWarn(`[${username}] Died! Auto-respawning...`);
                
                // Send respawn packet
                setTimeout(() => {
                    try {
                        bot.client.write("respawn", {
                            position: { x: 0, y: 0, z: 0 },
                            state: 0,
                            runtime_entity_id: 0
                        });
                        logInfo(`[${username}] Respawn packet sent`);
                    } catch (err) {
                        logError(`[${username}] Failed to respawn: ${err.message}`);
                    }
                }, 500);
            }
        });

        // Update pong time on any packet (server is responding)
        client.on("packet", () => {
            const bot = botClients.get(username);
            if (bot) {
                bot.lastPongTime = Date.now();
            }
        });

    } catch (error) {
        logError(`[${username}] Connection failed: ${error.message}`);
        botClients.delete(username);
    }
}

function handleBotDisconnect(username, message = "") {
    const botState = botClients.get(username);
    if (!botState || !botState.connected) return;
    
    botState.connected = false;
    stopPingMonitor(username);
    botState.client = null;
    
    if (!botState.reconnecting) {
        logWarn(`[${username}] Disconnected from server`);
        
        // Check if "already online" error
        const isAlreadyOnline = message.toLowerCase().includes("already online");
        
        // Trigger auto-reconnect if enabled
        if (botState.autoReconnectEnabled && config.ping.autoReconnect) {
            const delay = isAlreadyOnline ? 10000 : (config.ping.reconnectDelayMs || 3000);
            logInfo(`[${username}] Scheduled reconnect in ${delay}ms...`);
            botState.reconnecting = true;
            setTimeout(() => {
                logInfo(`[${username}] Attempting to reconnect...`);
                connectBot(username);
            }, delay);
        }
    }
}

function disconnectBot(username) {
    const botState = botClients.get(username);
    if (!botState) {
        logWarn(`[${username}] Bot not found`);
        return;
    }
    
    if (!botState.connected && !botState.reconnecting) {
        logWarn(`[${username}] Not connected`);
        return;
    }

    logInfo(`[${username}] Disconnecting...`);
    
    // Disable auto-reconnect when user manually disconnects
    if (!botState.reconnecting) {
        botState.autoReconnectEnabled = false;
    }
    
    stopPingMonitor(username);
    
    if (botState.client) {
        try {
            botState.client.close();
        } catch (e) {
            // Ignore close errors
        }
        botState.client = null;
    }
    
    botState.connected = false;
    botClients.delete(username);
}

function execCommandForBot(username, command, silent = false) {
    const botState = botClients.get(username);
    if (!botState || !botState.connected || !botState.client) {
        if (!silent) logWarn(`[${username}] Not connected`);
        return;
    }

    const cmd = command.startsWith("/") ? command : `/${command}`;
    
    try {
        botState.client.write("command_request", {
            command: cmd,
            origin: {
                type: "player",
                uuid: "",
                request_id: "",
                player_entity_id: 0,
            },
            internal: false,
            version: "52",
        });
        
        if (!silent) {
            logInfo(`[${username}] Sent: ${cmd}`);
        }
    } catch (error) {
        if (!silent) {
            logError(`[${username}] Command error: ${error.message}`);
        }
    }
}

// Connect to specific bot or all bots
async function connect(target = "all") {
    if (target === "all") {
        logInfo("Connecting all bots...");
        for (const bot of botsDatabase) {
            if (bot.enabled) {
                await connectBot(bot.username);
                // Small delay between connections
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } else {
        const bot = botsDatabase.find(b => b.username === target);
        if (!bot) {
            logError(`Bot "${target}" not found in database`);
            return;
        }
        if (!bot.enabled) {
            logWarn(`Bot "${target}" is disabled`);
            return;
        }
        await connectBot(target);
    }
}

// Disconnect specific bot or all bots
function disconnect(target = "all") {
    if (target === "all") {
        logInfo("Disconnecting all bots...");
        for (const [username] of botClients) {
            disconnectBot(username);
        }
    } else {
        disconnectBot(target);
    }
}

// Execute command for specific bot or all bots
function execCommand(target, command, silent = false) {
    if (target === "all") {
        for (const [username] of botClients) {
            execCommandForBot(username, command, silent);
        }
    } else {
        execCommandForBot(target, command, silent);
    }
}

// Console interface
rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
});

console.log("=".repeat(60));
console.log("BEDROCK HEADLESS CLIENT - MULTI BOT");
console.log("=".repeat(60));
console.log("Commands:");
console.log("  connect <username/all>           - Connect bot(s)");
console.log("  disconnect <username/all>        - Disconnect bot(s)");
console.log("  exec <username/all> <command>    - Execute command");
console.log("  list                             - List all bots");
console.log("  status                           - Show connection status");
console.log("  exit                             - Exit program");
console.log("=".repeat(60));
console.log(`Auto-reconnect: ${config.ping.autoReconnect ? 'enabled' : 'disabled'}`);
console.log(`Ping interval: ${config.ping.intervalMs}ms`);
console.log(`Ping timeout: ${config.ping.timeoutMs}ms`);
console.log(`Loaded bots: ${botsDatabase.length} (${botsDatabase.filter(b => b.enabled).length} enabled)`);
console.log("=".repeat(60));

setTimeout(() => rl.prompt(), 200);

rl.on("line", (line) => {
    const input = line.trim();

    if (!input) {
        rl.prompt();
        return;
    }

    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    // Exit
    if (cmd === "exit" || cmd === "quit") {
        logInfo("Shutting down...");
        disconnect("all");
        if (rl) {
            rl.close();
        }
        process.exit(0);
        return;
    }

    // List bots
    if (cmd === "list") {
        console.log("\n" + "=".repeat(60));
        console.log("BOTS DATABASE:");
        console.log("=".repeat(60));
        botsDatabase.forEach((bot, index) => {
            const status = bot.enabled ? "✓ enabled" : "✗ disabled";
            console.log(`${index + 1}. ${bot.username} [${status}]`);
        });
        console.log("=".repeat(60) + "\n");
        rl.prompt();
        return;
    }

    // Status
    if (cmd === "status") {
        console.log("\n" + "=".repeat(60));
        console.log("CONNECTION STATUS:");
        console.log("=".repeat(60));
        if (botClients.size === 0) {
            console.log("No bots connected");
        } else {
            for (const [username, bot] of botClients) {
                const status = bot.connected ? "✓ CONNECTED" : "✗ DISCONNECTED";
                console.log(`${username}: ${status}`);
            }
        }
        console.log("=".repeat(60) + "\n");
        rl.prompt();
        return;
    }

    // Connect
    if (cmd === "connect") {
        const target = parts[1] || "all";
        connect(target).then(() => rl.prompt());
        return;
    }

    // Disconnect
    if (cmd === "disconnect") {
        const target = parts[1] || "all";
        disconnect(target);
        rl.prompt();
        return;
    }

    // Execute command
    if (cmd === "exec") {
        if (parts.length < 3) {
            logWarn("Usage: exec <username/all> <command>");
            rl.prompt();
            return;
        }
        const target = parts[1];
        const command = parts.slice(2).join(" ");
        execCommand(target, command);
        rl.prompt();
        return;
    }

    logWarn("Unknown command. Available: connect, disconnect, exec, list, status, exit");
    rl.prompt();
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log(""); // New line after ^C
    logInfo("Shutting down...");
    disconnect("all");
    if (rl) {
        rl.close();
    }
    process.exit(0);
});

process.on("SIGTERM", () => {
    logInfo("Shutting down...");
    disconnect("all");
    if (rl) {
        rl.close();
    }
    process.exit(0);
});
