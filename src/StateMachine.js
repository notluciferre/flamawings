/**
 * STATE MACHINE UNTUK BEDROCK CLIENT
 *
 * Flow State:
 * DISCONNECTED → CONNECTING → AUTHENTICATING → RESOURCE_PACKS →
 * SPAWNING → WAITING_COMMANDS → READY → COMMAND_SENT →
 * WAITING_GUI → GUI_RECEIVED → CLICKING_SLOT → COMPLETED/ERROR
 */

export const ClientState = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  AUTHENTICATING: "AUTHENTICATING",
  RESOURCE_PACKS: "RESOURCE_PACKS",
  SPAWNING: "SPAWNING",
  WAITING_COMMANDS: "WAITING_COMMANDS",
  WAIT_INVENTORY_READY: "WAIT_INVENTORY_READY",
  READY: "READY",
  COMMAND_SENT: "COMMAND_SENT",
  WAITING_GUI: "WAITING_GUI",
  GUI_RECEIVED: "GUI_RECEIVED",
  CLICKING_SLOT: "CLICKING_SLOT",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
};

export class StateMachine {
  constructor(logger) {
    this.state = ClientState.DISCONNECTED;
    this.logger = logger;
    this.transitions = this._buildTransitions();
    this.stateData = {
      commandsAvailable: false,
      inventoryReady: false,
      windowId: null,
      containerType: null,
      containerSlots: null,
    };
  }

  _buildTransitions() {
    return {
      [ClientState.DISCONNECTED]: [ClientState.CONNECTING],
      [ClientState.CONNECTING]: [ClientState.AUTHENTICATING, ClientState.ERROR],
      [ClientState.AUTHENTICATING]: [
        ClientState.RESOURCE_PACKS,
        ClientState.SPAWNING,
        ClientState.ERROR,
      ],
      [ClientState.RESOURCE_PACKS]: [ClientState.SPAWNING, ClientState.ERROR],
      [ClientState.SPAWNING]: [
        ClientState.WAITING_COMMANDS,
        ClientState.WAIT_INVENTORY_READY,
        ClientState.READY,
        ClientState.ERROR,
      ],
      [ClientState.WAITING_COMMANDS]: [ClientState.READY, ClientState.ERROR],
      [ClientState.WAIT_INVENTORY_READY]: [
        ClientState.READY,
        ClientState.ERROR,
      ],
      [ClientState.READY]: [ClientState.COMMAND_SENT, ClientState.ERROR],
      [ClientState.COMMAND_SENT]: [ClientState.READY, ClientState.WAITING_GUI, ClientState.ERROR],
      [ClientState.WAITING_GUI]: [ClientState.GUI_RECEIVED, ClientState.READY, ClientState.ERROR],
      [ClientState.GUI_RECEIVED]: [
        ClientState.CLICKING_SLOT,
        ClientState.ERROR,
      ],
      [ClientState.CLICKING_SLOT]: [ClientState.COMPLETED, ClientState.ERROR],
      [ClientState.COMPLETED]: [],
      [ClientState.ERROR]: [],
    };
  }

  canTransition(newState) {
    const allowed = this.transitions[this.state] || [];
    return allowed.includes(newState);
  }

  transition(newState, reason = "") {
    if (!this.canTransition(newState)) {
      this.logger.error(
        `Invalid transition: ${this.state} → ${newState}. ` +
          `Allowed: ${this.transitions[this.state].join(", ")}`
      );
      return false;
    }

    const oldState = this.state;
    this.state = newState;
    this.logger.info(
      `State: ${oldState} → ${newState}` + (reason ? ` (${reason})` : "")
    );
    return true;
  }

  isReady() {
    return this.state === ClientState.READY;
  }

  canSendCommand() {
    return (
      this.state === ClientState.READY &&
      this.stateData.commandsAvailable &&
      this.stateData.inventoryReady
    );
  }

  setCommandsAvailable(available) {
    this.stateData.commandsAvailable = available;
    this.checkReadyState();
  }

  setInventoryReady(ready) {
    this.stateData.inventoryReady = ready;
    this.checkReadyState();
  }

  checkReadyState() {
    // Allow transition to READY from multiple states if conditions are met
    if (
      (this.state === ClientState.WAITING_COMMANDS ||
        this.state === ClientState.SPAWNING ||
        this.state === ClientState.WAIT_INVENTORY_READY) &&
      this.stateData.commandsAvailable &&
      this.stateData.inventoryReady
    ) {
      this.transition(ClientState.READY, "Commands & Inventory ready");
    }
  }

  setContainerData(windowId, containerType) {
    this.stateData.windowId = windowId;
    this.stateData.containerType = containerType;
  }

  getContainerData() {
    return {
      windowId: this.stateData.windowId,
      containerType: this.stateData.containerType,
    };
  }

  reset() {
    this.state = ClientState.DISCONNECTED;
    this.stateData = {
      commandsAvailable: false,
      inventoryReady: false,
      windowId: null,
      containerType: null,
      containerSlots: null,
    };
  }
}
