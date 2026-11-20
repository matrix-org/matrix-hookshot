import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HookshotOpenProjectModule from "../src";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import { AnchorView } from "../src/components/workPackage/AnchorView";
import { OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE } from "../src/capabilities/OpenProjectCapabilityClient";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "../src/schema/OpenProjectSchema";
import { AnchorMessageViewModel } from "../src/viewmodels/workPackage/AnchorMessageViewModel";
import { OPENPROJECT_WORK_PACKAGE_CREATED_EVENT } from "./fixtures/OpenProjectEventFixtures";
import { MockProfile, MockToDeviceApi } from "./helpers/MockToDeviceApi";

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
  const toDevice = new MockToDeviceApi();
  const profile = new MockProfile();
  const api = {
    config: {
      get: () => ({
        "org.matrix.matrix-hookshot": {
          integrationBots: { openproject: botUserId },
        },
      }),
    },
    client: { toDevice },
    profile,
    customComponents: { registerMessageRenderer },
  } as unknown as ConstructorParameters<typeof HookshotOpenProjectModule>[0];

  return {
    registerMessageRenderer,
    toDevice,
    profile,
    load: () => new HookshotOpenProjectModule(api).load(),
  };
}

describe("OpenProject marked anchor path", () => {
  it("renders a marked anchor and sends its probe through the Module API", async () => {
    const { registerMessageRenderer, toDevice, load } =
      createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({ mxEvent: createMarkedAnchorEvent() });

    expect(rendered.type).toBe(OpenProjectAnchorRenderer);
    const markup = renderToStaticMarkup(rendered);

    expect(markup).toContain("#41 This is a task");
    expect(markup).toContain("Checking OpenProject actions");
    expect(toDevice.calls.slice(0, 2)).toEqual(["subscribe", "send"]);
    expect(toDevice.sentMessages).toHaveLength(1);
    expect(toDevice.sentMessages[0]).toMatchObject({
      recipientUserId: botUserId,
      recipientDeviceId: "*",
      type: "org.matrix.matrix-hookshot.capabilities.probe",
      content: {
        v: 1,
        request_id: expect.any(String),
        requesting_device_id: "ALICE_DEVICE",
        integration_id: "openproject",
        room_id: "!openproject:example.org",
        anchor_event_id: "$openproject-anchor-41:example.org",
      },
    });
    const requestId = toDevice.sentMessages[0].content.request_id as string;
    toDevice.deliver(OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE, {
      type: OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      sender: botUserId,
      content: {
        v: 1,
        request_id: requestId,
        integration_id: "openproject",
        result: "ok",
      },
    });
  });

  it("renders the probe result and an unavailable state with retry", async () => {
    const { registerMessageRenderer, toDevice, load } =
      createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];
    const rendered = render({ mxEvent: createMarkedAnchorEvent() });
    toDevice.failOnSendCall(2, new Error("Timed out"));
    const vm = new AnchorMessageViewModel(rendered.props);
    const markup = () =>
      renderToStaticMarkup(React.createElement(AnchorView, { vm }));

    expect(markup()).toContain("Checking OpenProject actions");
    const requestId = toDevice.sentMessages[0].content.request_id as string;
    toDevice.deliver(OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE, {
      type: OPENPROJECT_CAPABILITIES_PROBE_RESPONSE_EVENT_TYPE,
      sender: botUserId,
      content: {
        v: 1,
        request_id: requestId,
        integration_id: "openproject",
        result: "ok",
      },
    });
    await vi.waitFor(() => {
      expect(markup()).toContain("OpenProject connection verified");
    });

    vm.retry();
    await vi.waitFor(() => {
      expect(markup()).toContain("OpenProject actions unavailable");
      expect(markup()).toContain("Retry");
    });
    expect(toDevice.sendMessage).toHaveBeenCalledTimes(2);
    vm.dispose();
  });

  it("does not probe a marked card from another sender", async () => {
    const { registerMessageRenderer, toDevice, load } =
      createModuleRegistration();
    await load();
    const [, render] = registerMessageRenderer.mock.calls[0];

    const rendered = render({
      mxEvent: createMarkedAnchorEvent("@spoofed:example.org"),
    });

    expect(rendered.type).not.toBe(OpenProjectAnchorRenderer);
    expect(toDevice.sendMessage).not.toHaveBeenCalled();
  });
});
