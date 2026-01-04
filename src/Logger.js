/**
 * LOGGER UTILITY
 */

export class Logger {
    constructor(config) {
        this.logPackets = config.debug?.logPackets ?? true;
        this.logState = config.debug?.logStateChanges ?? true;
    }

    info(message) {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
    }

    warn(message) {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`);
    }

    error(message) {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
    }

    packet(direction, name, data = null) {
        if (!this.logPackets) return;

        const arrow = direction === 'send' ? '→' : '←';
        let msg = `[PKT] ${arrow} ${name}`;

        if (data) {
            // Custom replacer untuk handle BigInt
            msg += ` ${JSON.stringify(data, (key, value) => {
                return typeof value === 'bigint' ? value.toString() : value;
            }, 2)}`;
        }

        console.log(msg);
    }

    state(oldState, newState, reason) {
        if (!this.logState) return;
        console.log(
            `[STATE] ${oldState} → ${newState}` +
            (reason ? ` | ${reason}` : '')
        );
    }
}