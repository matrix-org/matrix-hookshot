import { BridgeConfig } from "../../src/config/Config";
import { DefaultConfigRoot } from "../../src/config/Defaults";
import { expect } from "chai";


describe("Config/BridgeConfig", () => {
    describe("will handle the legacy queue.monolitihc option", () => {
        it("with no parameters", () => {
            const config = new BridgeConfig({ ...DefaultConfigRoot, queue: {
                monolithic: true
            }});
            expect(config.queue).to.be.undefined;
            expect(config.cache?.redisUri).to.equal("redis://localhost:6379");
        });

        it("with a host parameter", () => {
            const config = new BridgeConfig({ ...DefaultConfigRoot, queue: {
                monolithic: true,
                host: 'bark'
            }});
            expect(config.queue).to.be.undefined;
            expect(config.cache?.redisUri).to.equal("redis://bark:6379");
        });

        it("with a port parameter", () => {
            const config = new BridgeConfig({ ...DefaultConfigRoot, queue: {
                monolithic: true,
                port: 6379,
            }});
            expect(config.queue).to.be.undefined;
            expect(config.cache?.redisUri).to.equal("redis://localhost:6379");
        });

        it("with a host and port parameter", () => {
            const config = new BridgeConfig({ ...DefaultConfigRoot, queue: {
                monolithic: true,
                host: 'bark',
                port: 6379,
            }});
            expect(config.queue).to.be.undefined;
            expect(config.cache?.redisUri).to.equal("redis://bark:6379");
        });

        it("with monolithic disabled", () => {
            const config = new BridgeConfig({
                ...DefaultConfigRoot,
                encryption: undefined,
                queue: {
                    monolithic: false
                }
            });
            expect(config.queue).to.deep.equal({
                monolithic: false,
            });
            expect(config.cache?.redisUri).to.equal("redis://localhost:6379");
        });
    });

    describe("will handle the queue option", () => {
        it("with redisUri", () => {
            const config = new BridgeConfig({ ...DefaultConfigRoot,
                encryption: undefined,
                queue: {
                    redisUri: "redis://localhost:6379"
                },
                cache: undefined
            });
            expect(config.queue).to.deep.equal({
                redisUri: "redis://localhost:6379"
            });
            expect(config.cache).to.be.undefined;
        });
    });

    describe("will handle the cache option", () => {
        it("with redisUri", () => {
            const config = new BridgeConfig({
                ...DefaultConfigRoot,
                cache: {
                    redisUri: "redis://localhost:6379"
                },
                queue: undefined,
            });
            expect(config.cache).to.deep.equal({
                redisUri: "redis://localhost:6379"
            });
            expect(config.queue).to.be.undefined;
        });
    });
})