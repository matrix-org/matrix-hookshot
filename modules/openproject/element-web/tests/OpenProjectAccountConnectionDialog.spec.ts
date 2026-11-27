// @vitest-environment happy-dom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  Api,
  DialogHandle,
  DialogProps,
} from "@element-hq/element-web-module-api";
import type {
  OpenProjectAnchor,
  OpenProjectLoginStartResponse,
} from "../src/capabilities/OpenProjectCapabilityClient";
import type { ProfileIdentity } from "../src/capabilities/OpenProjectProfile";
import type { OpenProjectAccountConnectionState } from "../src/viewmodels/accountConnection/OpenProjectAccountConnectionViewModel";
import type { OpenProjectLoginClient } from "../src/viewmodels/accountConnection/OpenProjectAccountConnectionViewModel";
import {
  openOpenProjectAccountConnectionDialog,
  OpenProjectAccountConnectionDialog,
  OpenProjectAccountConnectionDialogView,
  type OpenProjectAccountConnectionDialogProps,
  type OpenProjectAccountConnectionDialogResult,
} from "../src/components/account/OpenProjectAccountConnectionDialog";

const authorizationUrl =
  "https://projects.example.org/oauth/authorize?client_id=example&state=storybook-example";

function renderState(state: OpenProjectAccountConnectionState) {
  const onLinkClick = vi.fn();
  const onRetry = vi.fn();
  render(
    React.createElement(OpenProjectAccountConnectionDialogView, {
      state,
      onLinkClick,
      onRetry,
    }),
  );
  return { onLinkClick, onRetry };
}

describe("OpenProjectAccountConnectionDialogView", () => {
  afterEach(() => cleanup());

  it("offers a user-activated, safely opened account link when ready", () => {
    const { onLinkClick } = renderState({
      kind: "ready",
      authorizationUrl,
    });
    const link = screen.getByRole("link", { name: "Link account" });

    expect(link.getAttribute("href")).toBe(authorizationUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link.tabIndex).toBe(0);
    fireEvent.click(link);
    expect(onLinkClick).toHaveBeenCalledOnce();
  });

  it("announces progress and does not expose an authorization link while starting", () => {
    renderState({ kind: "starting" });

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(
      "Preparing an OpenProject sign-in link",
    );
    expect(status.closest("header")).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Link account" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("keeps the link available while polling and uses an accessible retry label", () => {
    renderState({ kind: "polling", authorizationUrl });

    expect(screen.getByRole("status").textContent).toContain(
      "Waiting for OpenProject",
    );
    expect(
      screen
        .getByRole("link", { name: "Open sign-in again" })
        .getAttribute("href"),
    ).toBe(authorizationUrl);
  });

  it.each([
    ["denied", "You are not allowed to connect"],
    ["unavailable", "Hookshot could not complete"],
    ["configuration_error", "Contact your Hookshot administrator"],
    ["expired", "sign-in check expired"],
    ["session_changed", "Matrix account or device changed"],
  ] as const)(
    "shows the %s message without rendering a URL",
    (kind, message) => {
      renderState({ kind } as OpenProjectAccountConnectionState);

      expect(screen.getByRole("status").textContent).toContain(message);
      expect(screen.queryByRole("link")).toBeNull();
      expect(document.body.textContent).not.toContain(
        "state=storybook-example",
      );
    },
  );

  it("provides retry without a separate cancel button for recoverable errors", () => {
    const { onRetry } = renderState({ kind: "unavailable" });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("does not offer retry or a separate cancel button for a configuration error", () => {
    renderState({ kind: "configuration_error" });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Link account" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("does not offer actions after a successful connection", () => {
    renderState({ kind: "connected" });

    expect(screen.getByRole("status").textContent).toContain(
      "Package access is checked separately",
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Link account" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it.each([{ kind: "session_changed" }, { kind: "cancelled" }] as const)(
    "keeps a disabled link action for the $kind state",
    (state) => {
      renderState(state);

      expect(
        screen
          .getByRole("button", { name: "Link account" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    },
  );

  it("opens through Element's dialog API with an accessible title", () => {
    const anchor: OpenProjectAnchor = {
      roomId: "!room:example.org",
      eventId: "$anchor:example.org",
      snapshotId: "snapshot-1",
      workPackageId: 41,
      recipientUserId: "@hookshot:example.org",
    };
    const props: OpenProjectAccountConnectionDialogProps = {
      client: {} as OpenProjectLoginClient,
      anchor,
      baseUrl: new URL("https://projects.example.org"),
    };
    const handle = {
      finished: Promise.resolve({ ok: false, model: null }),
      close: vi.fn(),
    } as DialogHandle<OpenProjectAccountConnectionDialogResult>;
    const openDialog = vi.fn(() => handle);
    const api = { openDialog } as unknown as Pick<Api, "openDialog">;

    expect(openOpenProjectAccountConnectionDialog(api, props)).toBe(handle);
    expect(openDialog).toHaveBeenCalledWith(
      { title: "Connect your OpenProject account" },
      expect.any(Function),
      props,
    );
  });

  it("disposes pending work when the host closes the dialog", async () => {
    let resolveStart!: (response: OpenProjectLoginStartResponse) => void;
    const pendingStart = new Promise<OpenProjectLoginStartResponse>(
      (resolve) => {
        resolveStart = resolve;
      },
    );
    const identity: ProfileIdentity = {
      userId: "@alice:example.org",
      deviceId: "ALICE_DEVICE",
    };
    const unsubscribeSession = vi.fn();
    const client = {
      loginStart: vi.fn(() => pendingStart),
      loginStatus: vi.fn(),
      getSessionIdentity: vi.fn(() => identity),
      isSessionIdentityCurrent: vi.fn(() => true),
      watchSessionIdentity: vi.fn(() => unsubscribeSession),
    } as unknown as OpenProjectLoginClient;
    const onSubmit =
      vi.fn<
        DialogProps<OpenProjectAccountConnectionDialogResult>["onSubmit"]
      >();
    const anchor: OpenProjectAnchor = {
      roomId: "!room:example.org",
      eventId: "$anchor:example.org",
      snapshotId: "snapshot-1",
      workPackageId: 41,
      recipientUserId: "@hookshot:example.org",
    };
    const view = render(
      React.createElement(OpenProjectAccountConnectionDialog, {
        client,
        anchor,
        baseUrl: new URL("https://projects.example.org"),
        onSubmit,
        onCancel: vi.fn(),
      }),
    );

    expect(client.loginStart).toHaveBeenCalledOnce();
    view.unmount();
    resolveStart({
      v: 1,
      request_id: "late-start",
      integration_id: "openproject",
      result: "ready",
      auth_url: authorizationUrl,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(unsubscribeSession).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
