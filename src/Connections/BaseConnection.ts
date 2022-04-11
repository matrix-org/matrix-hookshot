import { FormatUtil } from "../FormatUtil";

/**
 * Base connection class from which all connections should extend from.
 */
export abstract class BaseConnection {
    constructor(
        public readonly roomId: string,
        public readonly stateKey: string,
        public readonly canonicalStateType: string) {

    }

    public get connectionId(): string {
        return FormatUtil.hashId(`${this.roomId}/${this.canonicalStateType}/${this.stateKey}`);
    }

    public get priority(): number {
        return -1;
    }
}