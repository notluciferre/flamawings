/**
 * GUI HANDLER
 * Menangani ContainerOpen, InventoryContent, dan InventoryTransaction
 * 
 * PENTING:
 * - Tunggu ContainerOpenPacket untuk dapat windowId
 * - Tunggu InventoryContentPacket sebelum click
 * - Slot index 0-based (DonutSMP: slot 16)
 * - Handle both Chest GUI dan Form GUI (ModalFormRequest)
 */

import { ClientState } from './StateMachine.js';

export class GUIHandler {
    constructor(client, stateMachine, logger, config) {
        this.client = client;
        this.sm = stateMachine;
        this.logger = logger;
        this.config = config;
        this.guiTimeout = null;
        this.containerData = {
            windowId: null,
            type: null,
            slots: [],
            received: false
        };
    }

    setupHandlers() {
        // CONTAINER_OPEN - Server membuka GUI (chest/hopper/etc)
        this.client.on('container_open', (packet) => {
            this.logger.packet('recv', 'container_open', {
                window_id: packet.window_id,
                type: packet.type
            });

            // Accept container dari state COMMAND_SENT atau READY juga
            if (this.sm.state === ClientState.COMMAND_SENT ||
                this.sm.state === ClientState.READY ||
                this.sm.state === ClientState.WAITING_GUI) {

                this.containerData.windowId = packet.window_id;
                this.containerData.type = packet.type;

                this.sm.setContainerData(packet.window_id, packet.type);
                this.sm.transition(ClientState.GUI_RECEIVED, 'Container opened');

                this.logger.info(
                    `Container opened: type=${packet.type}, windowId=${packet.window_id}`
                );
            }
        });

        // INVENTORY_CONTENT - Isi container (slots)
        this.client.on('inventory_content', (packet) => {
            const windowId = packet.window_id;

            // Hanya tangani windowId dari container yang dibuka
            if (windowId === this.containerData.windowId) {
                this.logger.packet('recv', 'inventory_content', {
                    window_id: windowId,
                    slot_count: packet.input?.length || 0
                });

                this.containerData.slots = packet.input || [];
                this.containerData.received = true;

                this.logger.info(
                    `Container inventory received: ${this.containerData.slots.length} slots`
                );

                // Auto-click jika sudah di state GUI_RECEIVED
                if (this.sm.state === ClientState.GUI_RECEIVED) {
                    const slotIndex = this.config.behavior.slotIndex;
                    this.logger.info(`Auto-clicking slot ${slotIndex} in 500ms...`);

                    setTimeout(() => {
                        this.clickSlot(slotIndex);
                    }, 500);
                }
            }
        });

        // INVENTORY_SLOT - Update single slot
        this.client.on('inventory_slot', (packet) => {
            if (packet.window_id === this.containerData.windowId) {
                this.logger.packet('recv', 'inventory_slot', {
                    window_id: packet.window_id,
                    slot: packet.slot
                });
            }
        });

        // CONTAINER_CLOSE - Server menutup GUI
        this.client.on('container_close', (packet) => {
            this.logger.packet('recv', 'container_close', {
                window_id: packet.window_id
            });

            if (packet.window_id === this.containerData.windowId) {
                this.logger.info('Container closed by server');

                if (this.sm.state === ClientState.CLICKING_SLOT) {
                    this.sm.transition(ClientState.COMPLETED, 'Slot clicked, GUI closed');
                }

                this.resetContainerData();
            }
        });

        // MODAL_FORM_REQUEST - Form GUI (button-based UI)
        this.client.on('modal_form_request', (packet) => {
            this.logger.packet('recv', 'modal_form_request', {
                form_id: packet.form_id
            });

            this.logger.warn(
                'Received ModalFormRequest - DonutSMP might use Form GUI instead of Chest'
            );

            // Jika server kirim form, kita perlu response dengan modal_form_response
            // Future: parse JSON form_data dan click button yang sesuai
        });

        // TEXT - Chat/system message (bisa berisi konfirmasi)
        this.client.on('text', (packet) => {
            if (packet.type === 'chat' || packet.type === 'system') {
                this.logger.info(`[${packet.type}] ${packet.message}`);
            }
        });
    }

    /**
     * CLICK SLOT DI CONTAINER
     * 
     * Mengirim InventoryTransactionPacket dengan:
     * - transaction_type: NORMAL (0)
     * - actions: source=CONTAINER, windowId, slotIndex
     * 
     * PENTING: Harus ada windowId dari ContainerOpenPacket
     */
    clickSlot(slotIndex) {
        if (!this.containerData.windowId) {
            this.logger.error('Cannot click slot: no windowId available');
            return false;
        }

        if (!this.containerData.received) {
            this.logger.error('Cannot click slot: inventory content not received yet');
            return false;
        }

        if (this.sm.state !== ClientState.GUI_RECEIVED) {
            this.logger.error(
                `Cannot click slot: invalid state ${this.sm.state}`
            );
            return false;
        }

        this.sm.transition(ClientState.CLICKING_SLOT, `Clicking slot ${slotIndex}`);

        const windowId = this.containerData.windowId;

        // Build InventoryTransactionPacket
        const transaction = {
            transaction_type: 'normal', // NORMAL transaction
            actions: [{
                source_type: 'container', // CONTAINER source
                window_id: windowId,
                slot: slotIndex,
                old_item: {
                    network_id: 0,
                    count: 0
                },
                new_item: {
                    network_id: 0,
                    count: 0
                }
            }]
        };

        this.client.write('inventory_transaction', transaction);
        this.logger.packet('send', 'inventory_transaction', {
            type: 'normal',
            window_id: windowId,
            slot: slotIndex
        });

        this.logger.info(`Slot ${slotIndex} clicked in windowId ${windowId}`);

        // Timeout jika server tidak response
        setTimeout(() => {
            if (this.sm.state === ClientState.CLICKING_SLOT) {
                this.logger.warn('No response after clicking slot, assuming success');
                this.sm.transition(ClientState.COMPLETED, 'Timeout assumed success');
            }
        }, 5000);

        return true;
    }

    resetContainerData() {
        clearTimeout(this.guiTimeout);
        this.containerData = {
            windowId: null,
            type: null,
            slots: [],
            received: false
        };
    }

    getContainerData() {
        return this.containerData;
    }
}