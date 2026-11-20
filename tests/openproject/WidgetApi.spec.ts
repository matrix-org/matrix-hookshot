import type { Response } from "express";
import type { ProvisioningRequest } from "matrix-appservice-bridge";
import { describe, expect, it, vi } from "vitest";
import { ErrCode } from "../../src/api";
import { OpenProjectWidgetAPI } from "../../src/openproject/WidgetApi";
import type { GetServiceStatusOptionsResponse } from "../../src/widgets/BridgeWidgetInterface";
import type { UserTokenStore } from "../../src/tokens/UserTokenStore";

describe("OpenProjectWidgetAPI", () => {
  describe("getStatuses", () => {
    it("returns all status summaries and their closed state", async () => {
      const statuses = [
        { id: 3, name: "New", isClosed: false },
        { id: 4, name: "Resolved", isClosed: true },
        { id: 5, name: "Rejected", isClosed: true },
      ];
      const client = {
        getStatuses: vi.fn().mockResolvedValue(statuses),
      };
      const tokenStore = {
        openProjectOAuth: {},
        getOpenProjectForUser: vi.fn().mockResolvedValue(client),
      } as unknown as UserTokenStore;
      const response = {
        json: vi.fn(),
      } as unknown as Response<GetServiceStatusOptionsResponse>;
      const request = { userId: "@alice:example.org" } as ProvisioningRequest;

      await OpenProjectWidgetAPI.getStatuses(request, response, tokenStore);

      expect(tokenStore.getOpenProjectForUser).toHaveBeenCalledWith(
        "@alice:example.org",
      );
      expect(client.getStatuses).toHaveBeenCalledOnce();
      expect(response.json).toHaveBeenCalledWith({
        statusOptions: [
          { id: "3", name: "New", isClosed: false },
          { id: "4", name: "Resolved", isClosed: true },
          { id: "5", name: "Rejected", isClosed: true },
        ],
      });
    });

    it("rejects requests without an authenticated Matrix user", async () => {
      const tokenStore = {
        openProjectOAuth: {},
        getOpenProjectForUser: vi.fn(),
      } as unknown as UserTokenStore;
      const response = {
        json: vi.fn(),
      } as unknown as Response<GetServiceStatusOptionsResponse>;

      await expect(
        OpenProjectWidgetAPI.getStatuses(
          {} as ProvisioningRequest,
          response,
          tokenStore,
        ),
      ).rejects.toMatchObject({ error: "Missing userId" });
      expect(tokenStore.getOpenProjectForUser).not.toHaveBeenCalled();
    });

    it("rejects users without a connected OpenProject account", async () => {
      const tokenStore = {
        openProjectOAuth: {},
        getOpenProjectForUser: vi.fn().mockResolvedValue(null),
      } as unknown as UserTokenStore;
      const response = {
        json: vi.fn(),
      } as unknown as Response<GetServiceStatusOptionsResponse>;

      await expect(
        OpenProjectWidgetAPI.getStatuses(
          { userId: "@alice:example.org" } as ProvisioningRequest,
          response,
          tokenStore,
        ),
      ).rejects.toMatchObject({
        errcode: ErrCode.BadToken,
        error: "OpenProject account is not connected",
      });
      expect(response.json).not.toHaveBeenCalled();
    });

    it("rejects when OpenProject OAuth is not configured", async () => {
      const tokenStore = {
        openProjectOAuth: undefined,
        getOpenProjectForUser: vi.fn(),
      } as unknown as UserTokenStore;
      const response = {
        json: vi.fn(),
      } as unknown as Response<GetServiceStatusOptionsResponse>;

      await expect(
        OpenProjectWidgetAPI.getStatuses(
          { userId: "@alice:example.org" } as ProvisioningRequest,
          response,
          tokenStore,
        ),
      ).rejects.toMatchObject({ errcode: ErrCode.UnsupportedOperation });
      expect(tokenStore.getOpenProjectForUser).not.toHaveBeenCalled();
    });
  });
});
