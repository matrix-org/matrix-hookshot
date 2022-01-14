import { permissionsCheckAction ,permissionsCheckActionAny } from "../../src/libRs";
import { expect } from "chai";

function generateSimplePermissionBlock(actor: string, service: string, level: string) {
    return [
        {
            actor,
            services: [
                {
                    service,
                    level
                }
            ],
        }
    ]
}

describe("Config/permissions", () => {
    describe("permissionsCheckAction", () => {
        it("will return false for an empty actor set", () => {
            expect(permissionsCheckAction([], "@foo:bar", "empty-service", "commands")).to.be.false;
        });
        it("will return false for an insufficent level", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('@foo:bar', 'my-service', 'login'),
                "@foo:bar", "my-service", "notifications")
            ).to.be.false;
        });
        it("will return false if the there are no matching services", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('@foo:bar', 'my-service', 'login'),
                "@foo:bar", "other-service", "login")
            ).to.be.false;
        });
        it("will return false if the target does not match", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('@foo:bar', 'my-service', 'login'),
                "@foo:baz", "my-service", "login")
            ).to.be.false;
        });
        it("will return true if there is a matching level and service", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('@foo:bar', 'my-service', 'login'),
                "@foo:bar", "my-service", "login")
            ).to.be.true;
        });
        it("will return true for a matching actor domain", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('bar', 'my-service', 'login'),
                "@foo:bar", "my-service", "login")
            ).to.be.true;
        });
        it("will return true for a wildcard actor", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('*', 'my-service', 'login'),
                "@foo:bar", "my-service", "login")
            ).to.be.true;
        });
        it("will return true for a wildcard service", () => {
            expect(permissionsCheckAction(
                generateSimplePermissionBlock('@foo:bar', '*', 'login'),
                "@foo:bar", "my-service", "login")
            ).to.be.true;
        });
        it("will fall through and return true for multiple permission sets", () => {
            const sets = [
                {
                    actor: "not-you",
                    services: [
                        {
                            service: "my-service",
                            level: "login"
                        }
                    ],
                },
                {
                    actor: "or-you",
                    services: [
                        {
                            service: "my-service",
                            level: "login"
                        }
                    ],
                },
                {
                    actor: "@foo:bar",
                    services: [
                        {
                            service: "my-service",
                            level: "commands"
                        }
                    ],
                }
            ];
            expect(permissionsCheckAction(sets, "@foo:bar", "my-service", "commands")).to.be.true;
            expect(permissionsCheckAction(sets, "@foo:bar", "my-service", "login")).to.be.false;
        });
    })
    describe("permissionsCheckActionAny", () => {
        it("will return false for an empty actor set", () => {
            expect(permissionsCheckActionAny([], "@foo:bar", "commands")).to.be.false;
        });
        it(`will return false for a service with an insufficent level`, () => {
            expect(
                permissionsCheckActionAny(generateSimplePermissionBlock("@foo:bar", "fake-service", "commands"),
                    "@foo:bar",
                    "login"
                )
            ).to.be.false;
        });
        const checkActorValues = ["@foo:bar", "bar", "*"];
        checkActorValues.forEach(actor => {
            it(`will return true for a service defintion of '${actor}' that has a sufficent level`, () => {
                expect(
                    permissionsCheckActionAny(
                        generateSimplePermissionBlock("@foo:bar", "fake-service", "commands"),
                        "@foo:bar",
                        "commands"
                    )
                ).to.be.true;
            });
        });
    })
})