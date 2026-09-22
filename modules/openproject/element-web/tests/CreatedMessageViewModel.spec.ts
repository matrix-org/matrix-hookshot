import { describe, expect, it } from "vitest";
import type { OpenProjectContent } from "../src/models/OpenProjectMatrixEventContent";
import { CreatedMessageViewModel } from "../src/viewmodels/workPackage/CreatedMessageViewModel";
import { WORK_PACKAGE } from "./fixtures/WorkPackageFixtures";

const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";

function createContent(overrides: OpenProjectContent = {}): OpenProjectContent {
  return { [WORK_PACKAGE_KEY]: WORK_PACKAGE, ...overrides };
}

function createDescriptionSnapshot(html: string) {
  return new CreatedMessageViewModel(
    createContent({
      [WORK_PACKAGE_KEY]: {
        ...WORK_PACKAGE,
        description: { plain: "Plain fallback", html },
      },
    }),
  ).getSnapshot()?.details.description;
}

describe("CreatedMessageViewModel", () => {
  it("exposes a snapshot for a created work package", () => {
    const viewModel = new CreatedMessageViewModel(createContent());
    const snapshot = viewModel.getSnapshot();

    expect(snapshot).toMatchObject({
      kind: "created",
      header: { action: "created", authorName: WORK_PACKAGE.author.name },
      details: {
        id: WORK_PACKAGE.id,
        subject: WORK_PACKAGE.subject,
        url: WORK_PACKAGE.url,
        author: {
          name: WORK_PACKAGE.author.name,
          url: WORK_PACKAGE.author.url,
        },
        status: {
          name: WORK_PACKAGE.status.name,
          color: WORK_PACKAGE.status.color,
        },
        type: { name: WORK_PACKAGE.type.name, color: WORK_PACKAGE.type.color },
      },
    });
  });

  it("removes scripts from HTML descriptions", () => {
    expect(
      createDescriptionSnapshot(
        "<script>alert(1)</script><strong>Safe text</strong>",
      ),
    ).toEqual({ plain: "Plain fallback", html: "<strong>Safe text</strong>" });
  });

  it("removes unsafe link URLs from HTML descriptions", () => {
    expect(
      createDescriptionSnapshot(
        '<a href="javascript:alert(1)">Unsafe link</a>',
      ),
    ).toEqual({ plain: "Plain fallback", html: "<a>Unsafe link</a>" });
  });

  it("removes inline styles from HTML descriptions", () => {
    expect(
      createDescriptionSnapshot('<p style="color:red">Styled text</p>'),
    ).toEqual({ plain: "Plain fallback", html: "<p>Styled text</p>" });
  });

  it("removes untrusted images and event handlers from HTML descriptions", () => {
    expect(
      createDescriptionSnapshot(
        '<img src="https://example.test/image.png"><img src="x" onerror="alert(1)">',
      ),
    ).toEqual({ plain: "Plain fallback", html: "<img /><img />" });
  });

  it("retains safe formatting and links in HTML descriptions", () => {
    expect(
      createDescriptionSnapshot(
        '<a href="https://example.test/path">Safe link</a><strong>Safe text</strong>',
      ),
    ).toEqual({
      plain: "Plain fallback",
      html: '<a href="https://example.test/path" target="_blank" rel="noreferrer noopener">Safe link</a><strong>Safe text</strong>',
    });
  });

  it("normalises unsafe URLs and colors before they reach a view", () => {
    const viewModel = new CreatedMessageViewModel(
      createContent({
        [WORK_PACKAGE_KEY]: {
          ...WORK_PACKAGE,
          url: "javascript:alert('unsafe')",
          author: { ...WORK_PACKAGE.author, url: "data:text/html,unsafe" },
          status: { ...WORK_PACKAGE.status, color: "rgb(0, 0, 0)" },
          type: { ...WORK_PACKAGE.type, color: "not-a-colour" },
        },
      }),
    );

    expect(viewModel.getSnapshot()?.details).toMatchObject({
      url: undefined,
      author: { url: undefined },
      status: { color: undefined },
      type: { color: undefined },
    });
  });

  it("returns null for incomplete messages", () => {
    expect(new CreatedMessageViewModel({}).getSnapshot()).toBeNull();
  });
});
