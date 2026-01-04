/**
 * BEDROCK CLIENT CORE
 * Menangani koneksi RakNet, login, dan lifecycle packet
 */

import bedrock from 'bedrock-protocol';
import { ClientState } from './StateMachine.js';

export class BedrockClient {
    constructor(config, stateMachine, logger) {
        this.config = config;
        this.sm = stateMachine;
        this.logger = logger;
        this.client = null;
        this.loginTimeout = null;
        this.commandTimeout = null;
        this.readyFallbackTimer = null;
    }

    /**
     * CONNECT & AUTHENTICATE
     * Flow: RakNet → Login → PlayStatus → ResourcePacks → StartGame
     */
    async connect() {
        this.sm.transition(ClientState.CONNECTING, 'Starting connection');

        const mode = this.config.mode || 'headless';
        this.logger.info(`Mode: ${mode.toUpperCase()}`);

        const options = {
            host: this.config.server.host,
            port: this.config.server.port,
            username: this.config.auth.username,
            offline: this.config.auth.offline,
            viewDistance: mode === 'gui' ? 8 : 4,
            keepAlive: true
        };

        // Skip version untuk auto-detection jika tidak support
        // bedrock-protocol akan auto-detect dari server
        if (this.config.server.autoVersion !== false) {
            this.logger.info('Using auto-version detection');
        } else if (this.config.server.version) {
            options.version = this.config.server.version;
        }

        // Mode GUI: render window (experimental, butuh electron-minecraft-window)
        // Mode headless: pure protocol, no rendering
        if (mode === 'gui') {
            options.skipPing = false;
            options.realms = false;
            // Future: integrate with minecraft-protocol renderer
            this.logger.warn('GUI mode experimental - window rendering not implemented');
        } else {
            options.skipPing = true;
        }

        try {
            this.logger.info(`Connecting to ${options.host}:${options.port}`);

            this.client = bedrock.createClient(options);

            // Packet-level logging (like main.js)
            this.client.on('packet', (data) => {
                try {
                    const name = data?.data?.name;
                    if (name && name !== 'set_time' && name !== 'network_chunk_publisher_update') {
                        // Log important packets
                        if (name === 'container_open' || 
                            name === 'container_close' ||
                            name === 'inventory_content' ||
                            name === 'inventory_slot' ||
                            name === 'modal_form_request') {
                            this.logger.packet('recv', name, data?.data?.params);
                        }
                    }
                } catch {}
            });

            this._setupPacketHandlers();
            this._setupErrorHandlers();

            // Timeout jika login terlalu lama
            this.loginTimeout = setTimeout(() => {
                if (this.sm.state !== ClientState.READY) {
                    this.logger.error('Login timeout exceeded');
                    this.sm.transition(ClientState.ERROR, 'Login timeout');
                    this.disconnect();
                }
            }, 60000);

            return new Promise((resolve, reject) => {
                this.client.once('error', reject);
                this.client.once('spawn', () => {
                    clearTimeout(this.loginTimeout);
                    resolve();
                });
            });

        } catch (error) {
            this.logger.error(`Connection failed: ${error.message}`);
            this.sm.transition(ClientState.ERROR, error.message);
            throw error;
        }
    }

    _setupPacketHandlers() {
        // PLAY_STATUS - Konfirmasi login berhasil
        this.client.on('play_status', (packet) => {
            this.logger.packet('recv', 'play_status', { status: packet.status });

            if (packet.status === 'login_success') {
                this.sm.transition(
                    ClientState.AUTHENTICATING,
                    'Login successful'
                );
            } else if (packet.status === 'player_spawn') {
                this.logger.info('Player spawned');
            }
        });

        // RESOURCE_PACK_STACK - Negotiation resource pack
        this.client.on('resource_pack_stack', (packet) => {
            this.logger.packet('recv', 'resource_pack_stack');

            this.sm.transition(
                ClientState.RESOURCE_PACKS,
                'Resource pack negotiation'
            );

            // Send accept
            this.client.write('resource_pack_client_response', {
                response_status: 'completed',
                resourcepackids: []
            });
            this.logger.packet('send', 'resource_pack_client_response');
        });

        // START_GAME - Game started, spawn process dimulai
        this.client.on('start_game', (packet) => {
            this.logger.packet('recv', 'start_game', {
                entity_id: packet.runtime_entity_id,
                gamemode: packet.player_gamemode
            });

            this.sm.transition(ClientState.SPAWNING, 'Game started');

            // Some servers don't send early inventory_content, use start_game as fallback
            if (!this.sm.stateData.inventoryReady) {
                this.logger.info('Inventory ready assumed from start_game (fallback)');
                this.sm.setInventoryReady(true);
            }

            // Request chunk radius
            this.client.write('request_chunk_radius', {
                chunk_radius: 4
            });
            this.logger.packet('send', 'request_chunk_radius');

            // Arm fallback timer in case available_commands is delayed
            this.armReadyFallback();

            if (this.sm.state === ClientState.SPAWNING) {
                this.sm.transition(
                    ClientState.WAITING_COMMANDS,
                    'Waiting for inventory'
                );
            }
        });

        // AVAILABLE_ACTOR_IDENTIFIERS
        this.client.on('available_actor_identifiers', (packet) => {
            this.logger.packet('recv', 'available_actor_identifiers');
        });

        // BIOME_DEFINITION_LIST
        this.client.on('biome_definition_list', (packet) => {
            this.logger.packet('recv', 'biome_definition_list');
        });

        // INVENTORY_CONTENT - Inventory ready (player inventory)
        this.client.on('inventory_content', (packet) => {
            this.logger.packet('recv', 'inventory_content', {
                window_id: packet.window_id
            });

            // Window ID 0 = player inventory
            if (packet.window_id === 0 || packet.window_id === '0') {
                this.sm.setInventoryReady(true);
            }
        });

        // INVENTORY_SLOT - Incremental inventory updates (fallback)
        this.client.on('inventory_slot', (packet) => {
            // Some servers send inventory_slot instead of full inventory_content
            if (packet.window_id === 0 || packet.window_id === '0') {
                if (!this.sm.stateData.inventoryReady) {
                    this.logger.info('Inventory ready detected via inventory_slot');
                    this.sm.setInventoryReady(true);
                }
            }
        });

        // SPAWN event dari bedrock-protocol
        this.client.on('spawn', () => {
            this.logger.info('Spawn sequence completed');
        });
    }

    _setupErrorHandlers() {
        this.client.on('error', (error) => {
            const msg = String(error?.message || error);

            // IMPORTANT: DonutSMP sends custom/extended data that trips the bedrock-protocol decoder
            // These "Read error" and "Invalid tag" errors are harmless and should be ignored
            // to keep the bot running smoothly
            if (msg.includes('Read error') || msg.includes('Invalid tag')) {
                // Silently ignore protocol decode errors from DonutSMP custom packets
                return;
            }

            this.logger.error(`Client error: ${msg}`);
            this.sm.transition(ClientState.ERROR, msg);
        });

        this.client.on('disconnect', (packet) => {
            this.logger.warn('Disconnected from server');
            if (packet?.message) {
                this.logger.info(`Reason: ${packet.message}`);
            }
        });

        this.client.on('kick', (reason) => {
            this.logger.error(`Kicked: ${reason.message || 'Unknown'}`);
            this.sm.transition(ClientState.ERROR, 'Kicked');
        });
    }

    armReadyFallback() {
        if (this.readyFallbackTimer) return;

        this.readyFallbackTimer = setTimeout(() => {
            if (!this.sm.stateData.commandsAvailable || !this.sm.stateData.inventoryReady) {
                this.logger.warn('Ready state fallback: forcing ready after 15s timeout');
                this.sm.setCommandsAvailable(true);
                this.sm.setInventoryReady(true);
            }
            this.readyFallbackTimer = null;
        }, 15000);
    }

    disconnect() {
        clearTimeout(this.loginTimeout);
        clearTimeout(this.commandTimeout);
        clearTimeout(this.readyFallbackTimer);

        if (this.client) {
            this.client.close();
            this.client = null;
        }

        this.sm.reset();
    }

    isConnected() {
        return this.client !== null;
    }

    getClient() {
        return this.client;
    }
}