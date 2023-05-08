import { LocalMQ } from "../libRs";

export class RsLocalMq extends LocalMQ {
    public on(eventGlob: string, callback: (...args: any[]) => any): void {
        super.on(eventGlob, (err, ...args) => {
            if (err) {
                // TODO: Handle this better
                throw Error(err);
            }
            callback(...args)
        })
    }

    public once(eventGlob: string, callback: (...args: any[]) => any): void {
        super.once(eventGlob, (err, ...args) => {
            if (err) {
                // TODO: Handle this better
                throw Error(err);
            }
            callback(...args)
        })
    }
}