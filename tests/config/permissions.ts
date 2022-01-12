import { permissionsCheckAction } from "../../src/libRs";
import { expect } from "chai";

describe("Config/permissions", () => {
    describe("permissionsCheckAction", () => {
        it("will return false for an empty actor set", async () => {
            expect(permissionsCheckAction([], "@foo:bar", "empty-service", "commands")).to.be.false;
        });
    })
})