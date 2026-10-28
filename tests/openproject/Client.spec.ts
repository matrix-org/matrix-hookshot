import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenProjectAPIClient,
  OpenProjectMalformedResponseError,
} from "../../src/openproject/Client";
import type { OpenProjectOAuth } from "../../src/openproject/Oauth";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

vi.mock("axios", () => ({
  default: {
    request: vi.fn(),
  },
}));

function createClient(
  tokenInfo = JSON.stringify({
    expires_in: Date.now() + 60_000,
    access_token: "access-token",
    refresh_token: "refresh-token",
  }),
  oauth = {} as unknown as OpenProjectOAuth,
  onTokenRefreshed = vi.fn(),
): OpenProjectAPIClient {
  return new OpenProjectAPIClient(BASE_URL, tokenInfo, oauth, onTokenRefreshed);
}

describe("OpenProjectAPIClient", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the configured API origin", () => {
    expect(createClient().getOrigin()).toBe(BASE_URL.origin);
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

  it("refreshes an expired token before making the API request", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValue({ data: { id: 1 } } as never);
    const exchangeRefreshToken = vi.fn().mockResolvedValue({
      expires_in: 3_600,
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
    });
    const oauth = { exchangeRefreshToken } as unknown as OpenProjectOAuth;
    const onTokenRefreshed = vi.fn();
    const client = createClient(
      JSON.stringify({
        expires_in: 1,
        access_token: "expired-access-token",
        refresh_token: "old-refresh-token",
      }),
      oauth,
      onTokenRefreshed,
    );

    await client.getProject(1);

    expect(exchangeRefreshToken).toHaveBeenCalledWith("old-refresh-token");
    expect(onTokenRefreshed).toHaveBeenCalledWith({
      expires_in: expect.any(Number),
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer refreshed-access-token" },
      }),
    );
  });

  it("does not make a request when the token cannot be refreshed", async () => {
    const request = vi.mocked(axios.request);
    const client = createClient(
      JSON.stringify({ expires_in: 1, access_token: "expired-access-token" }),
    );

    await expect(client.getProject(1)).rejects.toThrow(
      "Cannot refresh token, token does not support it",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("validates identity responses and encodes the requested user ID", async () => {
    const request = vi.mocked(axios.request);
    const identity = {
      id: 5,
      name: "Alice",
      _links: { self: { href: "/api/v3/users/5" } },
    };
    request.mockResolvedValue({ data: identity } as never);
    const client = createClient();

    await expect(client.getIdentity("me/team")).resolves.toEqual(identity);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${BASE_URL}api/v3/users/me%2Fteam`,
      }),
    );

    request.mockResolvedValueOnce({
      data: { ...identity, id: 0 },
    } as never);
    await expect(client.getIdentity()).rejects.toBeInstanceOf(
      OpenProjectMalformedResponseError,
    );
  });

  it("rejects a work package whose response ID does not match the request", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValue({
      data: {
        id: WORK_PACKAGE.id + 1,
        lockVersion: 4,
        _embedded: { project: { id: 1 }, assignee: null },
      },
    } as never);
    const client = createClient();

    await expect(client.getWorkPackage(WORK_PACKAGE.id)).rejects.toThrow(
      "Invalid OpenProject work package response",
    );
  });

  it("rejects malformed work-package form and assignee collection responses", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValueOnce({ data: {} } as never);
    request.mockResolvedValueOnce({
      data: { _embedded: { elements: [{ id: 7, _links: { self: {} } }] } },
    } as never);
    const client = createClient();

    await expect(client.getWorkPackageForm(WORK_PACKAGE.id)).rejects.toThrow(
      "Invalid OpenProject work package form response",
    );
    await expect(
      client.hasAvailableAssignee(WORK_PACKAGE.id, 7),
    ).rejects.toThrow("Invalid available assignees collection response");
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

  it("follows offset and cursor links until the target assignee is found", async () => {
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
      client.hasAvailableAssignee(WORK_PACKAGE.id, thirdAssignee.id),
    ).resolves.toBe(true);

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

  it("stops assignee pagination as soon as the target user is found", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValueOnce({
      data: {
        _embedded: {
          elements: [
            { id: 12, _links: { self: { href: "/api/v3/users/12" } } },
          ],
        },
        _links: {
          nextByOffset: {
            href: `/api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees?offset=2`,
          },
        },
      },
    } as never);
    request.mockRejectedValueOnce(new Error("Later page unavailable"));
    const client = createClient();

    await expect(
      client.hasAvailableAssignee(WORK_PACKAGE.id, 12),
    ).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("exhausts assignee pages when the target user is absent", async () => {
    const request = vi.mocked(axios.request);
    request
      .mockResolvedValueOnce({
        data: {
          _embedded: {
            elements: [
              { id: 11, _links: { self: { href: "/api/v3/users/11" } } },
            ],
          },
          _links: {
            nextByOffset: {
              href: `/api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees?offset=2`,
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          _embedded: {
            elements: [
              { id: 13, _links: { self: { href: "/api/v3/users/13" } } },
            ],
          },
        },
      } as never);
    const client = createClient();

    await expect(
      client.hasAvailableAssignee(WORK_PACKAGE.id, 12),
    ).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
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

    await expect(
      client.hasAvailableAssignee(WORK_PACKAGE.id, 12),
    ).rejects.toThrow("different origin");

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stops when a collection repeats a page link", async () => {
    const request = vi.mocked(axios.request);
    const path = `/api/v3/work_packages/${WORK_PACKAGE.id}/available_assignees`;
    request.mockResolvedValueOnce({
      data: {
        _embedded: { elements: [] },
        _links: { nextByOffset: { href: path } },
      },
    } as never);
    const client = createClient();

    await expect(
      client.hasAvailableAssignee(WORK_PACKAGE.id, 12),
    ).rejects.toThrow("cyclic collection page link");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid collection page URL", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValueOnce({
      data: {
        _embedded: { elements: [] },
        _links: { nextByOffset: { href: "http://[invalid" } },
      },
    } as never);
    const client = createClient();

    await expect(
      client.hasAvailableAssignee(WORK_PACKAGE.id, 12),
    ).rejects.toThrow("invalid collection page link");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("searches all project pages and retains the optional project filter", async () => {
    const request = vi.mocked(axios.request);
    const firstProject = { id: 1, name: "One" };
    const secondProject = { id: 2, name: "Two" };
    request
      .mockResolvedValueOnce({
        data: {
          _embedded: { elements: [firstProject] },
          _links: { nextByOffset: { href: "/api/v3/projects?offset=2" } },
        },
      } as never)
      .mockResolvedValueOnce({
        data: { _embedded: { elements: [secondProject] } },
      } as never);
    const client = createClient();

    await expect(client.searchProjects("bridge")).resolves.toEqual([
      { ...firstProject, project_url: `${BASE_URL}projects/1` },
      { ...secondProject, project_url: `${BASE_URL}projects/2` },
    ]);

    const firstUrl = new URL(String(request.mock.calls[0][0]?.url));
    expect(JSON.parse(firstUrl.searchParams.get("filters") ?? "[]")).toEqual([
      { name_and_identifier: { operator: "~", values: ["bridge"] } },
    ]);
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: `${BASE_URL}api/v3/projects?offset=2`,
      }),
    );
  });

  it("searches projects without adding a filter when no search term is supplied", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValueOnce({
      data: { _embedded: { elements: [{ id: 4, name: "Four" }] } },
    } as never);
    const client = createClient();

    await expect(client.searchProjects()).resolves.toEqual([
      { id: 4, name: "Four", project_url: `${BASE_URL}projects/4` },
    ]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${BASE_URL}api/v3/projects` }),
    );
  });

  it("finds a project member on a later page and stops after the match", async () => {
    const request = vi.mocked(axios.request);
    request
      .mockResolvedValueOnce({
        data: {
          id: 1,
          _links: { memberships: { href: "/api/v3/memberships?project=1" } },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          _embedded: {
            elements: [
              {
                _links: {
                  principal: { href: "/api/v3/users/2", title: "Bob" },
                },
              },
            ],
          },
          _links: {
            nextByOffset: {
              href: "/api/v3/memberships?project=1&offset=2",
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          _embedded: {
            elements: [
              {
                _links: {
                  principal: { href: "/api/v3/users/3", title: "Alice" },
                },
              },
            ],
          },
          _links: {
            nextByOffset: {
              href: "/api/v3/memberships?project=1&offset=3",
            },
          },
        },
      } as never);
    const client = createClient();

    await expect(client.searchForUserInProject(1, "  ALICE ")).resolves.toEqual(
      { href: "/api/v3/users/3", title: "Alice" },
    );

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: `${BASE_URL}api/v3/memberships?project=1&offset=2`,
      }),
    );
  });

  it("returns undefined when no project member matches", async () => {
    const request = vi.mocked(axios.request);
    request
      .mockResolvedValueOnce({
        data: {
          id: 1,
          _links: { memberships: { href: "/api/v3/memberships?project=1" } },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          _embedded: {
            elements: [
              {
                _links: {
                  principal: { href: "/api/v3/users/2", title: "Bob" },
                },
              },
            ],
          },
        },
      } as never);
    const client = createClient();

    await expect(
      client.searchForUserInProject(1, "Alice"),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns collection elements for project types, statuses, and priorities", async () => {
    const request = vi.mocked(axios.request);
    const type = { id: 2, name: "Bug" };
    const status = { id: 3, name: "New" };
    const priority = { id: 4, name: "High" };
    request
      .mockResolvedValueOnce({
        data: { _embedded: { elements: [type] } },
      } as never)
      .mockResolvedValueOnce({
        data: { _embedded: { elements: [status] } },
      } as never)
      .mockResolvedValueOnce({
        data: { _embedded: { elements: [priority] } },
      } as never);
    const client = createClient();

    await expect(client.getTypesInProject(9)).resolves.toEqual([type]);
    await expect(client.getStatuses()).resolves.toEqual([status]);
    await expect(client.getPriorities()).resolves.toEqual([priority]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("sends the expected create and comment payloads", async () => {
    const request = vi.mocked(axios.request);
    request
      .mockResolvedValueOnce({ data: WORK_PACKAGE } as never)
      .mockResolvedValueOnce({ data: {} } as never);
    const client = createClient();
    const type = {
      ...WORK_PACKAGE._embedded.type,
      _links: { self: { href: "/api/v3/types/2", title: "Milestone" } },
    };

    await client.createWorkPackage(9, type, "New package", "Details");
    await expect(
      client.addWorkPackageComment(WORK_PACKAGE.id, "A comment"),
    ).resolves.toBeUndefined();

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "POST",
        url: `${BASE_URL}api/v3/projects/9/work_packages`,
        data: {
          subject: "New package",
          description: { raw: "Details", format: "markdown" },
          _links: { type: { href: "/api/v3/types/2", title: "Milestone" } },
        },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        url: `${BASE_URL}api/v3/work_packages/${WORK_PACKAGE.id}/activities`,
        data: { comment: { raw: "A comment" } },
      }),
    );
  });

  it("does not add a description to a work package when none is provided", async () => {
    const request = vi.mocked(axios.request);
    request.mockResolvedValueOnce({ data: WORK_PACKAGE } as never);
    const client = createClient();
    const type = WORK_PACKAGE._embedded.type;

    await client.createWorkPackage(9, type, "New package");

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        data: {
          subject: "New package",
          _links: { type: type._links.self },
        },
      }),
    );
  });
});
