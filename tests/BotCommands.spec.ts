import { expect } from "chai";
import {
  botCommand,
  BotCommands,
  compileBotCommands,
  handleCommand,
} from "../src/BotCommands";
import { MatrixEvent } from "../src/MatrixEvent";
import { BridgePermissionLevel } from "../src/config/Config";

describe("BotCommands", () => {
  const USER_ID = "@foo:bar.com";
  const fakeReply: MatrixEvent<void> = {
    content: undefined,
    event_id: "$event:id",
    sender: "@sender",
    origin_server_ts: 12345,
    state_key: undefined,
    type: "test.type",
  };

  describe("handleCommand", () => {
    it("should not handle an empty command list", async () => {
      const outcome = await handleCommand(
        USER_ID,
        "!foo",
        undefined,
        {},
        null,
        () => true,
      );
      expect(outcome.handled).to.be.false;
    });

    it("should handle a simple command", async () => {
      let wasCalled = false;
      const outcome = await handleCommand(
        USER_ID,
        "simple",
        undefined,
        {
          simple: {
            help: "Some help text",
            fn: async () => {
              wasCalled = true;
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.true;
      expect(wasCalled).to.be.true;
    });

    it("should handle a simple with spaces", async () => {
      let wasCalled = false;
      const outcome = await handleCommand(
        USER_ID,
        "simple with spaces",
        undefined,
        {
          "simple with spaces": {
            help: "Some help text",
            fn: async () => {
              wasCalled = true;
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.true;
      expect(wasCalled).to.be.true;
    });

    it("should handle a command with arguments", async () => {
      let wasCalled = false;
      const outcome = await handleCommand(
        USER_ID,
        "simple hi there true 123",
        undefined,
        {
          simple: {
            help: "Some help text",
            fn: async (...unexpectedArgs: unknown[]) => {
              wasCalled = true;
              expect(unexpectedArgs).to.equal(["hi", "there", "true", "123"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.true;
      expect(wasCalled).to.be.true;
    });

    it("should handle a command with a userId", async () => {
      let wasCalled = false;
      const outcome = await handleCommand(
        USER_ID,
        "simple hi",
        undefined,
        {
          simple: {
            help: "Some help text",
            includeUserId: true,
            fn: async (userId: unknown, ...unexpectedArgs: unknown[]) => {
              wasCalled = true;
              expect(userId).to.equal(USER_ID);
              expect(unexpectedArgs).to.equal(["hi"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.true;
      expect(wasCalled).to.be.true;
    });

    it("should handle a command with a reply", async () => {
      let wasCalled = false;

      const outcome = await handleCommand(
        USER_ID,
        "simple hi",
        fakeReply,
        {
          simple: {
            help: "Some help text",
            includeReply: true,
            fn: async (reply: unknown, ...unexpectedArgs: unknown[]) => {
              wasCalled = true;
              expect(reply).to.equal(fakeReply);
              expect(unexpectedArgs).to.equal(["hi"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.true;
      expect(wasCalled).to.be.true;
    });

    it("should ignore a command if it does not expect a reply and one was provided", async () => {
      let wasCalled = false;
      const outcome = await handleCommand(
        USER_ID,
        "simple hi",
        fakeReply,
        {
          simple: {
            help: "Some help text",
            fn: async () => {
              wasCalled = false;
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.false;
      expect(wasCalled).to.be.false;
    });

    it("should handle a command with a userId and reply", async () => {
      let wasCalled = false;
      const outcome = await handleCommand(
        USER_ID,
        "simple hi",
        fakeReply,
        {
          simple: {
            help: "Some help text",
            includeReply: true,
            includeUserId: true,
            fn: async (
              userId: string,
              reply: unknown,
              ...unexpectedArgs: unknown[]
            ) => {
              wasCalled = true;
              expect(userId).to.equal(USER_ID);
              expect(reply).to.equal(fakeReply);
              expect(unexpectedArgs).to.equal(["hi"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).to.be.true;
      expect(wasCalled).to.be.true;
    });

    it("should handle a simple command using a prefix", async () => {
      const command = {
        simple: {
          help: "Some help text",
          fn: async () => undefined,
        },
      };
      expect(
        (
          await handleCommand(
            USER_ID,
            "simple",
            undefined,
            command,
            null,
            () => true,
            undefined,
            "my-prefix",
          )
        ).handled,
      ).to.be.false;
      expect(
        (
          await handleCommand(
            USER_ID,
            "my-prefix simple",
            undefined,
            command,
            null,
            () => true,
            undefined,
            "my-prefix",
          )
        ).handled,
      ).to.be.true;
    });

    it("should handle a simple command using a global prefix", async () => {
      const commands: BotCommands = {
        "no-prefix": {
          help: "Some help text",
          runOnGlobalPrefix: false,
          fn: async () => undefined,
        },
        "with-prefix": {
          help: "Some help text",
          runOnGlobalPrefix: true,
          fn: async () => undefined,
        },
      };

      // Commands must register to be part of the global prefix.
      expect(
        (
          await handleCommand(
            USER_ID,
            "glob-prefix no-prefix",
            undefined,
            commands,
            null,
            () => true,
            undefined,
            undefined,
            "glob-prefix",
          )
        ).handled,
      ).to.be.false;
      expect(
        (
          await handleCommand(
            USER_ID,
            "glob-prefix with-prefix",
            undefined,
            commands,
            null,
            () => true,
            undefined,
            "glob-prefix",
          )
        ).handled,
      ).to.be.true;
    });

    it("should reject a command with too few arguments", async () => {
      const command: BotCommands = {
        simple: {
          help: "Some help text",
          fn: async () => undefined,
          requiredArgs: ["foo", "bar"],
        },
      };
      const handle = (cmd: string) =>
        handleCommand(
          USER_ID,
          cmd,
          undefined,
          command,
          null,
          () => true,
          undefined,
          "my-prefix",
        );
      expect(await handle("my-prefix simple")).to.haveOwnProperty("humanError");
      expect(await handle("my-prefix simple 1")).to.haveOwnProperty(
        "humanError",
      );
      expect(await handle("my-prefix simple 1 2")).not.to.haveOwnProperty(
        "humanError",
      );
    });

    it("should handle permissions", async () => {
      const command: BotCommands = {
        admincommand: {
          help: "Some help text",
          fn: async () => undefined,
          permissionLevel: BridgePermissionLevel.admin,
          permissionService: "my-service",
        },
      };
      const handle = (cmd: string, allowPermission: boolean) =>
        handleCommand(
          USER_ID,
          cmd,
          undefined,
          command,
          null,
          (service, level) => {
            expect(service).to.equal("my-service");
            expect(level).to.equal(BridgePermissionLevel.admin);
            return allowPermission;
          },
          undefined,
        );
      expect(await handle("adminCommand", false)).to.haveOwnProperty(
        "humanError",
      );
      expect(await handle("adminCommand", true)).not.to.haveOwnProperty(
        "humanError",
      );
    });
  });

  describe("compiled bot commands", () => {
    it("can compile a class with bot commands", () => {
      class TestBotCommands {
        @botCommand("command", "a simple bit of help text")
        public async myTestCommand() {}
        @botCommand(
          "command two",
          "a simple bit of help text",
          ["withargs"],
          ["optionalArgs"],
        )
        public async myTestCommandWithArgs() {}
      }
      const output = compileBotCommands(TestBotCommands.prototype as any);
      expect(output.helpMessage()).to.deep.equal({
        body: " - `command` - a simple bit of help text\n - `command two <withargs> [optionalArgs]` - a simple bit of help text\n",
        format: "org.matrix.custom.html",
        formatted_body:
          "<ul>\n<li><code>command</code> - a simple bit of help text</li>\n<li><code>command two &lt;withargs&gt; [optionalArgs]</code> - a simple bit of help text</li>\n</ul>\n",
        msgtype: "m.notice",
      });
    });

    it("can will fail if two commands share a prefix", () => {
      class TestBotCommands {
        @botCommand("command", "a simple bit of help text")
        public async myTestCommand() {}
        @botCommand("command", "another simple bit of help text")
        public async myTestCommandWithArgs() {}
      }
      expect(() =>
        compileBotCommands(TestBotCommands.prototype as any),
      ).to.throw("Two commands cannot share the same prefix");
    });

    it("can dynamically switch off categories", () => {
      class TestBotCommands {
        @botCommand("command", "a simple bit of help text")
        public async myTestCommand() {}
        @botCommand("command two", { help: "more text", category: "test-cat" })
        public async myTestCommandWithArgs() {}
      }
      const output = compileBotCommands(TestBotCommands.prototype as any);
      // By default show all
      expect(output.helpMessage("!test-prefix ").body).to.equal(
        " - `!test-prefix command` - a simple bit of help text\n### Test-cat\n - `!test-prefix command two` - more text\n",
      );
      // Or when specified
      expect(output.helpMessage("!test-prefix ", ["test-cat"]).body).to.equal(
        " - `!test-prefix command` - a simple bit of help text\n### Test-cat\n - `!test-prefix command two` - more text\n",
      );
      // But not when unspecified
      expect(
        output.helpMessage("!test-prefix ", ["unrelated-cat"]).body,
      ).to.equal(" - `!test-prefix command` - a simple bit of help text\n");
    });
  });
});
