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

function createClient(): OpenProjectAPIClient {
  return new OpenProjectAPIClient(
    BASE_URL,
    JSON.stringify({
      expires_in: Date.now() + 60_000,
      access_token: "access-token",
      refresh_token: "refresh-token",
    }),
    {} as unknown as OpenProjectOAuth,
    vi.fn(),
  );
}

describe("OpenProjectAPIClient", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("patches a work package with the supplied lock version without fetching a newer one", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValue({ data: WORK_PACKAGE } as never);
    const client = createClient();

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

  it("posts an empty payload to retrieve the current work package form", async () => {
    const request = vi.mocked(axios.request);
    const form = {
      _embedded: {
        payload: { lockVersion: WORK_PACKAGE.lockVersion },
        schema: {
          assignee: { type: "User", writable: true },
          status: {
            type: "Status",
            writable: true,
            _embedded: {
              allowedValues: [
                {
                  id: 5,
                  name: "Closed",
                  isClosed: true,
                  _links: { self: { href: "/api/v3/statuses/5" } },
                },
              ],
            },
          },
        },
        validationErrors: {},
      },
    };
    request.mockResolvedValue({ data: form } as never);
    const client = createClient();

    await expect(client.getWorkPackageForm(WORK_PACKAGE.id)).resolves.toEqual(
      form,
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}/form`,
        data: {},
      }),
    );
  });

  it("posts proposed changes to validate them against the work package form", async () => {
    const request = vi.mocked(axios.request);
    const form = {
      _embedded: {
        payload: { lockVersion: 4 },
        schema: {
          assignee: { type: "User", writable: true },
        },
        validationErrors: {
          assignee: {
            _type: "Error" as const,
            errorIdentifier:
              "urn:openproject-org:api:v3:errors:PropertyConstraintViolation",
            message: "The assignee is not allowed.",
          },
        },
      },
    };
    request.mockResolvedValue({ data: form } as never);
    const client = createClient();
    const changes = {
      lockVersion: 4,
      _links: { assignee: { href: "/api/v3/users/11" } },
    };

    await expect(
      client.getWorkPackageForm(WORK_PACKAGE.id, changes),
    ).resolves.toEqual(form);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}/form`,
        data: changes,
      }),
    );
  });

  it("follows offset and cursor links to collect all available assignees", async () => {
    const request = vi.mocked(axios.request);
    const firstAssignee = {
      id: 11,
      _links: { self: { href: "/api/v3/users/11" } },
    };
    const secondAssignee = {
      id: 12,
      _links: { self: { href: "/api/v3/users/12" } },
    };
    const thirdAssignee = {
      id: 13,
      _links: { self: { href: "/api/v3/users/13" } },
    };
    request
      .mockResolvedValueOnce({
        data: {
          _embedded: { elements: [firstAssignee] },
          _links: {
            nextByOffset: {
              href: `/api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees?offset=2`,
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          _embedded: { elements: [secondAssignee] },
          _links: {
            nextByCursor: {
              href: `/api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees?cursor=next`,
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: { _embedded: { elements: [thirdAssignee] } },
      } as never);
    const client = createClient();

    await expect(
      client.getAvailableAssignees(WORK_PACKAGE.id),
    ).resolves.toEqual([firstAssignee, secondAssignee, thirdAssignee]);

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees`,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees?offset=2`,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees?cursor=next`,
      }),
    );
  });

  it("does not follow an assignee page link to a different origin", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValueOnce({
      data: {
        _embedded: { elements: [] },
        _links: { nextByOffset: { href: "https://other.example/steal-token" } },
      },
    } as never);
    const client = createClient();

    await expect(client.getAvailableAssignees(WORK_PACKAGE.id)).rejects.toThrow(
      "different origin",
    );

    expect(request).toHaveBeenCalledTimes(1);
  });
});
