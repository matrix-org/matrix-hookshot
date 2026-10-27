import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenProjectAPIClient } from "../../src/openproject/Client";
import type { OpenProjectOAuth } from "../../src/openproject/Oauth";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

vi.mock("axios", () => ({
  default: {
    request: vi.fn(),
  },
}));

describe("OpenProjectAPIClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("patches a work package with the supplied lock version without fetching a newer one", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValue({ data: WORK_PACKAGE } as never);
    const client = new OpenProjectAPIClient(
      BASE_URL,
      JSON.stringify({
        expires_in: Date.now() + 60_000,
        access_token: "access-token",
        refresh_token: "refresh-token",
      }),
      {} as unknown as OpenProjectOAuth,
      vi.fn(),
    );

    await client.updateWorkPackage(WORK_PACKAGE.id, 7, {
      _links: { status: { href: "/api/v3/statuses/5" } },
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}`,
        data: {
          _links: { status: { href: "/api/v3/statuses/5" } },
          lockVersion: 7,
        },
      }),
    );
  });
});
