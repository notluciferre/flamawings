/**
 * COMMAND HANDLER
 * Mengirim CommandRequestPacket dengan origin PLAYER
 *
 * PENTING:
 * - Gunakan CommandRequestPacket (bukan ChatPacket)
 * - Origin harus PLAYER (0)
 * - Internal harus false
 * - Tunggu state READY sebelum kirim
 */

import { ClientState } from "./StateMachine.js";

export class CommandHandler {
  constructor(client, stateMachine, logger, config) {
    this.client = client;
    this.sm = stateMachine;
    this.logger = logger;
    this.config = config;
  }

  /**
   * KIRIM COMMAND KE SERVER
   *
   * @param {string} command - Command tanpa slash atau dengan slash
   * @returns {boolean} - Success or not
   */
  sendCommand(command) {
    if (!this.sm.canSendCommand()) {
      this.logger.error(
        `Cannot send command in state: ${this.sm.state}. ` +
          `Commands available: ${this.sm.stateData.commandsAvailable}, ` +
          `Inventory ready: ${this.sm.stateData.inventoryReady}`
      );
      return false;
    }

    // Ensure command starts with /
    const cmd = command.startsWith("/") ? command : `/${command}`;

    this.sm.transition(ClientState.COMMAND_SENT, `Sending: ${cmd}`);

    // Kirim CommandRequestPacket
    // IMPORTANT: version MUST be a string in bedrock-protocol 1.21.x
    const packet = {
      command: cmd,
      origin: {
        type: "player", // PLAYER origin (bukan server)
        uuid: "",
        request_id: "",
        player_entity_id: 0,
      },
      internal: false, // HARUS false untuk player command
      version: "52", // MUST be string, not number
    };

    this.client.write("command_request", packet);
    this.logger.packet("send", "command_request", {
      command: cmd,
      origin: "player",
    });

    this.logger.info(`Command sent: ${cmd}`);

    // Langsung kembali ke READY
    // Jika ada container_open, state akan berubah ke WAITING_GUI
    setTimeout(() => {
      if (this.sm.state === ClientState.COMMAND_SENT) {
        this.sm.transition(
          ClientState.READY,
          "Command completed, ready for next"
        );
      }
    }, 500);

    return true;
  }

  /**
   * SCHEDULE COMMAND DENGAN DELAY
   */
  scheduleCommand(command, delayMs) {
    this.logger.info(`Command scheduled in ${delayMs}ms: ${command}`);

    return new Promise((resolve) => {
      setTimeout(() => {
        const success = this.sendCommand(command);
        resolve(success);
      }, delayMs);
    });
  }

  /**
   * TUNGGU READY STATE
   */
  async waitForReady(timeoutMs = 30000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.sm.canSendCommand()) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error("Timeout waiting for ready state"));
        }
      }, 100);
    });
  }
}
