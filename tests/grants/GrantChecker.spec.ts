import { expect } from "chai";
import { BridgeConfig } from "../../src/config/Config";
import { DefaultConfigRoot } from "../../src/config/Defaults";
import { FormatUtil } from "../../src/FormatUtil";
import { ConfigGrantChecker, GrantChecker, GrantRejectedError } from '../../src/grants/GrantCheck';
import { AppserviceMock } from "../utils/AppserviceMock";
import { IntentMock } from "../utils/IntentMock";

const ROOM_ID = '!a-room:bar';
const CONNECTION_ID = '!a-room:bar';
const ALWAYS_GRANT_USER = '@grant_me:bar';
const GRANT_SERVICE_USER = '@grant_service_user:bar';
const GRANT_SERVCE_LOW_PERMS = '@grant_service_user_without_perms:bar';
const GRANT_WRONG_SERVCE_USER = '@grant_wrong_service_user:bar';
const ALICE_USERID = '@alice:bar';
const GRANT_SERVICE = 'example-grant';

async function doesAssert(checker: GrantChecker<string>, roomId: string, connectionId: string, sender?: string) {
    try {
        await checker.assertConnectionGranted(roomId, connectionId, sender);
        throw Error(`Expected ${roomId}/${connectionId} to have thrown an error`)
    } catch (ex) {
        expect(ex).instanceOf(GrantRejectedError, 'Error thrown, but was not a grant rejected error');
        expect(ex.roomId).to.equal(roomId, "Grant rejected, but roomId didn't match");
        // connectionIds are always hashed
        expect(ex.connectionId).to.equal(FormatUtil.hashId(connectionId), "Grant rejected, but connectionId didn't match");
        return true;
    }
}

class TestGrantChecker extends GrantChecker {
    protected checkFallback(roomId: string, connectionId: string | object, sender?: string | undefined) {
        return sender === ALWAYS_GRANT_USER;
    }
}

describe("GrantChecker", () => {
    describe('base grant system', () => {
        let check: GrantChecker<string>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let intent: any;

        beforeEach(() => {
            intent = IntentMock.create('@foo:bar');
            check = new TestGrantChecker(intent, GRANT_SERVICE);
        });

        it('will grant a connection', async () => {
            await check.grantConnection(ROOM_ID, CONNECTION_ID);
            // And then to check that the grant has now been allowed.
            await check.assertConnectionGranted(ROOM_ID, CONNECTION_ID);
        });

        it('will assert on a missing grant', async () => {
            await doesAssert(
                check,
                ROOM_ID,
                CONNECTION_ID
            );
        });

        it('will allow a missing grant if sender matches', async () => {
            // Use the special user to grant the connection
            await check.assertConnectionGranted(ROOM_ID, CONNECTION_ID, ALWAYS_GRANT_USER);

            // And then to check that the grant has now been allowed.
            await check.assertConnectionGranted(ROOM_ID, CONNECTION_ID);
        });

        it('will not conflict with another connection id', async () => {
            await check.grantConnection(ROOM_ID, CONNECTION_ID);
            await doesAssert(
                check,
                ROOM_ID,
                CONNECTION_ID + "2",
            );
        });

        it('will not conflict with another room', async () => {
            await check.grantConnection(ROOM_ID, CONNECTION_ID);
            await doesAssert(
                check,
                ROOM_ID + "2",
                CONNECTION_ID
            );
        });

        it('will not conflict with another grant service', async () => {
            const anotherchecker = new TestGrantChecker(intent, GRANT_SERVICE + "-two");
            await check.grantConnection(ROOM_ID, CONNECTION_ID);

            await doesAssert(
                anotherchecker,
                ROOM_ID,
                CONNECTION_ID
            );
        });
    });

    describe('config fallback', () => {
        let check: GrantChecker<string>;
        let as: AppserviceMock;

        beforeEach(() => {
            const mockAs = AppserviceMock.create();
            as = mockAs;
            const config = new BridgeConfig(
                {
                    ...DefaultConfigRoot,
                    permissions: [{
                        actor: ALWAYS_GRANT_USER,
                        services: [{
                            service: '*',
                            level: "admin",
                        }],
                    },
                    {
                            actor: GRANT_SERVICE_USER,
                            services: [{
                                service: GRANT_SERVICE,
                                level: "admin",
                            }]
                    },
                    {
                        actor: GRANT_SERVCE_LOW_PERMS,
                        services: [{
                            service: GRANT_SERVICE,
                            level: 'notifications',
                        }]
                    },
                    {
                        actor: GRANT_WRONG_SERVCE_USER,
                        services: [{
                            service: 'another-service',
                            level: "admin",
                        }]
                    }],
                }
            );
            check = new ConfigGrantChecker(GRANT_SERVICE, mockAs, config);
        });

        it('will deny a missing grant if the sender is not provided', async () => {
            await doesAssert(
                check,
                ROOM_ID,
                CONNECTION_ID
            );
        });

        it('will deny a missing grant if the sender is not in the appservice whitelist', async () => {
            await doesAssert(
                check,
                ROOM_ID,
                CONNECTION_ID,
                ALICE_USERID,
            );
        });

        it('will grant if the user is part of the appservice', async () => {
            await check.assertConnectionGranted(ROOM_ID, CONNECTION_ID,  as.namespace + "bot");
        });

        it('will grant if the user has access to all services', async () => {
            await check.assertConnectionGranted(ROOM_ID, CONNECTION_ID,  ALWAYS_GRANT_USER);
        });

        it('will grant if the user has access to this service', async () => {
            await check.assertConnectionGranted(ROOM_ID, CONNECTION_ID,  GRANT_SERVICE_USER);
        });

        it('will not grant if the user has low access to this service', async () => {
            await doesAssert(check, ROOM_ID, CONNECTION_ID, GRANT_SERVCE_LOW_PERMS);
        });

        it('will not grant if the user has access to a different service', async () => {
            await doesAssert(check, ROOM_ID, CONNECTION_ID, GRANT_WRONG_SERVCE_USER);
        });
    });
});
