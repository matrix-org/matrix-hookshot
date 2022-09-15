import { expect } from "chai";
import { Writable } from "stream";
import LogWrapper, { GlobalLogger } from "../src/LogWrapper";

const tortureArgs: [unknown, ...unknown[]][] = [
    ["test-msg"],
    [Number.MAX_VALUE],
    [false],
    [Buffer.from('foo')],
    [new Error('Test')],
    [undefined],
    [null],
    [NaN],
    [[]],
    [() => { /*dummy*/}],
    ["Foo", "test-msg"],
    ["Foo", Number.MAX_VALUE],
    ["Foo", false],
    ["Foo", Buffer.from('foo')],
    ["Foo", new Error('Test')],
    ["Foo", undefined],
    ["Foo", null],
    ["Foo", NaN],
    ["Foo", []],
    ["Foo", () => { /*dummy*/}],
]

const MODULE_NAME = 'LogTesting';

describe('LogWrapper', () => {
    describe('text logger torture test', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        const global = new GlobalLogger();
        global.configureLogging({
            json: false,
            level: 'debug',
        }, new Writable({
            write(chunk, _encoding, callback) {
                data = chunk.toString();
                callback();
            },
        }));

        const log = new LogWrapper(MODULE_NAME, global);
        for (const args of tortureArgs) {
            it(`handles logging '${args.map(t => typeof t).join(', ')}'`, () => {
                for (const level of ['debug', 'info', 'warn', 'error']) {
                    log[level as 'debug'|'info'|'warn'|'error'](args[0], ...args.slice(1));
                    expect(data).to.include(level.toUpperCase());
                    expect(data).to.include(MODULE_NAME);
                    expect(data).to.not.be.undefined;
                }
            })
        }
    });
    describe('JSON logger torture test', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        const global = new GlobalLogger();
        global.configureLogging({
            json: true,
            level: 'debug',
        }, new Writable({
            write(chunk, _encoding, callback) {
                data = JSON.parse(chunk.toString());
                callback();
            },
        }));

        const log = new LogWrapper(MODULE_NAME, global);
        for (const args of tortureArgs) {
            it(`handles logging '${args.map(t => typeof t).join(', ')}'`, () => {
                for (const level of ['debug', 'info', 'warn', 'error']) {
                    log[level as 'debug'|'info'|'warn'|'error'](args[0], ...args.slice(1));
                    expect(data.level).to.equal(level.toUpperCase());
                    expect(data.module).to.equal(MODULE_NAME);
                    expect(data.message).to.not.be.undefined;
                    expect(data.timestamp).to.not.be.undefined;
                    if (args.length > 1) {
                        expect(data.args).to.have.lengthOf(args.length-1);
                    }
                }
            })
        }
    });
});