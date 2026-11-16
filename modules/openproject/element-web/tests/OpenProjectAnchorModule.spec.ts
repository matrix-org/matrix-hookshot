import { describe, expect, it, vi } from "vitest";
import HookshotOpenProjectModule from "../src";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/OpenProjectSchema";
import { OPENPROJECT_WORK_PACKAGE_CREATED_EVENT } from "./fixtures/OpenProjectEventFixtures";

const botUserId = "@hookshot_openproject:example.org";

function createMarkedAnchorEvent(sender = botUserId) {
  return {
    ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT,
    eventId: "$openproject-anchor-41:example.org",
    roomId: "!openproject:example.org",
    sender,
    content: {
      ...OPENPROJECT_WORK_PACKAGE_CREATED_EVENT.content,
      "org.matrix.matrix-hookshot.openproject.schema_version":
        OPENPROJECT_EVENT_SCHEMA_VERSION,
      "org.matrix.matrix-hookshot.openproject.event_kind":
        OPENPROJECT_ANCHOR_EVENT_KIND,
    },
  };
}

function createModuleRegistration() {
  const registerMessageRenderer = vi.fn();
  const toDeviceRequest = vi.fn();
  const api = {
    config: {
      get: () => ({
        "org.matrix.matrix-hookshot": {
          integrationBots: { openproject: botUserId },
        },
      }),
    },
    client: { toDevice: { request: toDeviceRequest } },
    customComponents: { registerMessageRenderer },
  } as unknown as ConstructorParameters<typeof HookshotOpenProjectModule>[0];

  return {
    registerMessageRenderer,
    toDeviceRequest,
    load: () => new HookshotOpenProjectModule(api).load(),
  };
}

describe("OpenProject marked anchor path", () => {
  it("routes a configured, sender-matched anchor through the probe card", async () => {
    const { registerMessageRenderer, toDeviceRequest, load } =
      createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({ mxEvent: createMarkedAnchorEvent() });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    toDeviceRequest.mockResolvedValue({
      v: 1,
      request_id: "request-1",
      integration_id: "openproject",
      result: "ok",
    });
    await rendered.props.capabilityClient.probe(rendered.props.anchor);
    expect(toDeviceRequest).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: botUserId }),
    );
  });

  it("does not probe a marked card from another sender", async () => {
    const { registerMessageRenderer, load } = createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({
      mxEvent: createMarkedAnchorEvent("@spoofed:example.org"),
    });

    expect(rendered.type).not.toBe(OpenProjectAnchorRenderer);
  });
});
