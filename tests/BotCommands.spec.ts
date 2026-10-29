import { describe, it, expect } from "vitest";
import {
  botCommand,
  BotCommands,
  compileBotCommands,
  handleCommand,
} from "../src/BotCommands";
import { BridgePermissionLevel } from "../src/config/BridgePermissionLevel";
import { RoomEvent } from "matrix-bot-sdk";
import { Category } from "../src/AdminRoomCommandHandler";

describe("BotCommands", () => {
  const USER_ID = "@foo:bar.com";
  const fakeReply: RoomEvent<Record<string, never>> = new RoomEvent({
    content: {},
    event_id: "$event:id",
    sender: "@sender",
    origin_server_ts: 12345,
    state_key: undefined,
    type: "test.type",
  });

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
      expect(outcome.handled).toBe(false);
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
      expect(outcome.handled).toBe(true);
      expect(wasCalled).toBe(true);
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
      expect(outcome.handled).toBe(true);
      expect(wasCalled).toBe(true);
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
              expect(unexpectedArgs).toBe(["hi", "there", "true", "123"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).toBe(true);
      expect(wasCalled).toBe(true);
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
              expect(userId).toBe(USER_ID);
              expect(unexpectedArgs).toBe(["hi"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).toBe(true);
      expect(wasCalled).toBe(true);
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
              expect(reply).toBe(fakeReply);
              expect(unexpectedArgs).toBe(["hi"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).toBe(true);
      expect(wasCalled).toBe(true);
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
      expect(outcome.handled).toBe(false);
      expect(wasCalled).toBe(false);
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
              expect(userId).toBe(USER_ID);
              expect(reply).toBe(fakeReply);
              expect(unexpectedArgs).toBe(["hi"]);
              return undefined;
            },
          },
        },
        null,
        () => true,
      );
      expect(outcome.handled).toBe(true);
      expect(wasCalled).toBe(true);
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
      ).toBe(false);
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
      ).toBe(true);
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
      ).toBe(false);
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
      ).toBe(true);
    });

    it.each([
      {
        command: "!project unknown",
        prefix: "!project ",
        globalPrefix: undefined,
        expectedPrefix: "!project",
      },
      {
        command: "!openproject unknown",
        prefix: undefined,
        globalPrefix: "!openproject",
        expectedPrefix: "!openproject",
      },
    ])(
      "reports an unknown command after the $expectedPrefix prefix",
      async ({ command, prefix, globalPrefix, expectedPrefix }) => {
        const outcome = await handleCommand(
          USER_ID,
          command,
          undefined,
          {},
          null,
          () => true,
          undefined,
          prefix,
          globalPrefix,
        );

        expect(outcome).toEqual({
          handled: true,
          humanError: `Unknown command. Try "${expectedPrefix} help" for available commands.`,
        });
      },
    );

    it("does not handle unrelated messages or lookalike global prefixes", async () => {
      const handle = (command: string) =>
        handleCommand(
          USER_ID,
          command,
          undefined,
          {},
          null,
          () => true,
          undefined,
          "!project ",
          "!openproject",
        );

      expect((await handle("hello there")).handled).toBe(false);
      expect((await handle("!openproject-extra unknown")).handled).toBe(false);
      expect(
        (
          await handleCommand(
            USER_ID,
            "unknown",
            undefined,
            {},
            null,
            () => true,
          )
        ).handled,
      ).toBe(false);
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
      expect(await handle("my-prefix simple")).toHaveProperty("humanError");
      expect(await handle("my-prefix simple 1")).toHaveProperty("humanError");
      expect(await handle("my-prefix simple 1 2")).not.toHaveProperty(
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
            expect(service).toBe("my-service");
            expect(level).toBe(BridgePermissionLevel.admin);
            return allowPermission;
          },
          undefined,
        );
      expect(await handle("adminCommand", false)).toHaveProperty("humanError");
      expect(await handle("adminCommand", true)).not.toHaveProperty(
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
      expect(output.helpMessage()).toEqual({
        body: " - `command` - a simple bit of help text\n - `command two <withargs> [optionalArgs]` - a simple bit of help text\n",
        format: "org.matrix.custom.html",
        formatted_body:
          "<ul>\n<li><code>command</code> - a simple bit of help text</li>\n<li><code>command two &lt;withargs&gt; [optionalArgs]</code> - a simple bit of help text</li>\n</ul>\n",
        msgtype: "m.notice",
      });
    });

    it("renders alternative help usages with context notes", () => {
      class TestBotCommands {
        @botCommand("priority", {
          help: "Set the priority for a work package",
          helpUsages: [
            { args: ["<workPackageId>", "<priority>"] },
            {
              args: ["<priority>"],
              note: "reply to a work package",
              prefix: "global",
            },
          ],
        })
        public async setPriority() {}
      }

      const output = compileBotCommands(
        TestBotCommands.prototype as unknown as Record<
          string,
          (...args: string[]) => Promise<undefined>
        >,
      );
      const help = output.helpMessage(
        "!openproject <projectId> ",
        undefined,
        undefined,
        "!openproject ",
      );
      expect(help.body).toBe(
        " - `!openproject <projectId> priority <workPackageId> <priority>` - Set the priority for a work package\n" +
          " - `!openproject priority <priority>` (reply to a work package) - Set the priority for a work package\n",
      );
      expect(help.formatted_body).toContain(
        "<code>!openproject &lt;projectId&gt; priority &lt;workPackageId&gt; &lt;priority&gt;</code>",
      );
      expect(help.formatted_body).toContain(
        "<code>!openproject priority &lt;priority&gt;</code> (reply to a work package)",
      );
    });

    it("uses the global prefix for globally available help", () => {
      class TestBotCommands {
        @botCommand("help", {
          help: "This help text",
          helpUsages: [{ args: [], prefix: "global" }],
          runOnGlobalPrefix: true,
        })
        public async help() {}
      }

      const output = compileBotCommands(
        TestBotCommands.prototype as unknown as Record<
          string,
          (...args: string[]) => Promise<undefined>
        >,
      );
      expect(
        output.helpMessage(
          "!openproject <projectId> ",
          undefined,
          undefined,
          "!openproject ",
        ).body,
      ).toBe(" - `!openproject help` - This help text\n");
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
      ).toThrow("Two commands cannot share the same prefix");
    });

    it("can dynamically switch off categories", () => {
      class TestBotCommands {
        @botCommand("command", "a simple bit of help text")
        public async myTestCommand() {}
        @botCommand("command two", {
          help: "more text",
          category: Category.Widget,
        })
        public async myTestCommandWithArgs() {}
      }
      const output = compileBotCommands(TestBotCommands.prototype as any);
      // By default show all
      expect(output.helpMessage("!test-prefix ").body).toBe(
        " - `!test-prefix command` - a simple bit of help text\n### Widget\n - `!test-prefix command two` - more text\n",
      );
      // Or when specified
      expect(output.helpMessage("!test-prefix ", [Category.Widget]).body).toBe(
        " - `!test-prefix command` - a simple bit of help text\n### Widget\n - `!test-prefix command two` - more text\n",
      );
      // But not when unspecified
      expect(output.helpMessage("!test-prefix ", ["unrelated-cat"]).body).toBe(
        " - `!test-prefix command` - a simple bit of help text\n",
      );
    });
  });
});
