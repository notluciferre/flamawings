/**
 * MAIN ENTRY POINT
 * Manual command execution via console (like main.js reference)
 */

import fs from "fs";
import readline from "readline";
import { Logger } from "./Logger.js";
import { StateMachine, ClientState } from "./StateMachine.js";
import { BedrockClient } from "./BedrockClient.js";
import { CommandHandler } from "./CommandHandler.js";
import { GUIHandler } from "./GUIHandler.js";

class BedrockAFKClient {
  constructor(configPath = "./config.json") {
    // Load config
    this.config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    // Initialize components
    this.logger = new Logger(this.config);
    this.sm = new StateMachine(this.logger);
    this.bedrockClient = new BedrockClient(this.config, this.sm, this.logger);
    this.commandHandler = null;
    this.guiHandler = null;
    this.connected = false;
    this.desiredSlotIndex = this.config.behavior.slotIndex || 16;
  }

  async connect() {
    if (this.connected) {
      console.log("[boot] already connected");
      return;
    }

    try {
      console.log("=".repeat(60));
      console.log("BEDROCK AFK CLIENT - DonutSMP");
      console.log("=".repeat(60));
      console.log(
        `Target: ${this.config.server.host}:${this.config.server.port}`
      );
      console.log(`Mode: ${this.config.mode || "headless"}`);
      console.log(`Slot: ${this.desiredSlotIndex}`);
      console.log("=".repeat(60));

      // Connect to server
      await this.bedrockClient.connect();
      this.connected = true;

      const client = this.bedrockClient.getClient();

      // Initialize handlers
      this.commandHandler = new CommandHandler(
        client,
        this.sm,
        this.logger,
        this.config
      );

      this.guiHandler = new GUIHandler(
        client,
        this.sm,
        this.logger,
        this.config
      );

      // Setup GUI handlers
      this.guiHandler.setupHandlers();

      this.connected = true;
      this.logger.info("✓ Connected! Waiting for ready state...");
      this.logger.info('Use "cmd <command>" to send commands manually');
    } catch (error) {
      this.logger.error(`Failed to connect: ${error.message}`);
      this.connected = false;
    }
  }

  disconnect() {
    if (!this.connected) {
      console.log("[boot] not connected");
      return;
    }

    this.logger.info("Disconnecting...");
    this.bedrockClient.disconnect();
    this.connected = false;
    this.commandHandler = null;
    this.guiHandler = null;
  }

  canSendCommands() {
    return this.connected && this.commandHandler && this.sm.canSendCommand();
  }

  sendCommand(commandLine) {
    if (!this.canSendCommands()) {
      console.log(
        `[manual] not ready to send commands yet (state=${this.sm.state})`
      );
      return false;
    }

    return this.commandHandler.sendCommand(commandLine);
  }

  getState() {
    return {
      connected: this.connected,
      state: this.sm.state,
      commandsAvailable: this.sm.stateData.commandsAvailable,
      inventoryReady: this.sm.stateData.inventoryReady,
      windowId: this.sm.stateData.windowId,
      slotIndex: this.config.behavior.slotIndex,
    };
  }
}

// Initialize client
const client = new BedrockAFKClient("./config.json");

// Console interface (manual control like main.js)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

console.log("[boot] DonutSMP Client - Manual Mode");
console.log(
  "[boot] Commands: connect | disconnect | state | cmd <command> | slot <n> | exit"
);
console.log('[boot] Type "connect" to start');

setTimeout(() => rl.prompt(), 200);

rl.on("line", (line) => {
  const input = line.trim();

  if (!input) {
    rl.prompt();
    return;
  }

  // Exit
  if (input === "exit" || input === "quit") {
    console.log("[exit] shutting down");
    client.disconnect();
    process.exit(0);
    return;
  }

  // Connect
  if (input === "connect") {
    client.connect().then(() => rl.prompt());
    return;
  }

  // Disconnect
  if (input === "disconnect") {
    client.disconnect();
    rl.prompt();
    return;
  }

  // State
  if (input === "state") {
    console.log(client.getState());
    rl.prompt();
    return;
  }

  // Set slot index
  if (input === "slot" || input.startsWith("slot ")) {
    const n = input === "slot" ? NaN : Number(input.slice(5).trim());
    if (!Number.isInteger(n) || n < 0) {
      console.log("Usage: slot <index> (0-based)");
    } else {
      client.config.behavior.slotIndex = n;
      console.log(`[cfg] slotIndex=${n}`);
    }
    rl.prompt();
    return;
  }

  // Send command
  if (input.startsWith("cmd ")) {
    const cmd = input.slice(4).trim();
    if (!cmd) {
      console.log("Usage: cmd <command>");
    } else {
      client.sendCommand(cmd);
    }
    rl.prompt();
    return;
  }

  // Shortcut for /tpa
  if (input === "tpa" || input.startsWith("tpa ")) {
    const rest = input === "tpa" ? "" : input.slice(4).trim();
    const cmdLine = rest ? `/tpa ${rest}` : "/tpa";
    client.sendCommand(cmdLine);
    rl.prompt();
    return;
  }

  console.log(
    "Commands: connect | disconnect | state | cmd <command> | tpa [player] | slot <n> | exit"
  );
  rl.prompt();
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[exit] shutting down");
  client.disconnect();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[exit] shutting down");
  client.disconnect();
  process.exit(0);
});
