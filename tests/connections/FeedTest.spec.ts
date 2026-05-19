import { AppserviceMock } from "../utils/AppserviceMock";
import { FeedConnection, FeedConnectionState } from "../../src/Connections";
import { FeedEntry } from "../../src/feeds/FeedReader";
import { IntentMock } from "../utils/IntentMock";
import { randomUUID } from "crypto";
import { expect } from "chai";
import axios from "axios";

const ROOM_ID = "!foo:bar";
const FEED_URL = "https://example.com/feed.xml";
const FEED_ENTRY_DEFAULTS: FeedEntry = {
  feed: {
    title: "Test feed",
    url: FEED_URL,
  },
  title: "Foo",
  link: "foo/bar",
  pubdate: "today!",
  summary: "fibble fobble",
  author: "Me!",
  fetchKey: randomUUID(),
};

function createFeed(
  state: Partial<FeedConnectionState> = {},
): [FeedConnection, IntentMock] {
  const as = AppserviceMock.create();
  const intent = as.getIntentForUserId("@webhooks:example.test");
  const connection = new FeedConnection(
    ROOM_ID,
    "foobar",
    {
      label: undefined,
      template: undefined,
      notifyOnFailure: undefined,
      url: FEED_URL,
      ...state,
    },
    intent,
  );
  return [connection, intent];
}
describe("FeedConnection", () => {
  it("will handle simple feed message", async () => {
    const [connection, intent] = createFeed();
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.external_url).to.equal(FEED_ENTRY_DEFAULTS.link);
    expect(matrixEvt.content.body).to.equal(
      "New post in Test feed: [Foo](foo/bar)",
    );
  });

  it("will handle simple feed message without a title and link ", async () => {
    const [connection, intent] = createFeed();
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      title: null,
      link: null,
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.external_url).to.be.undefined;
    expect(matrixEvt.content.body).to.equal("New post in Test feed");
  });

  it("will handle simple feed message with a missing title ", async () => {
    const [connection, intent] = createFeed();
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      title: null,
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.body).to.equal(
      "New post in Test feed: [foo/bar](foo/bar)",
    );
  });

  it("will handle simple feed message with a missing link ", async () => {
    const [connection, intent] = createFeed();
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      link: null,
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.body).to.equal("New post in Test feed: Foo");
  });

  it("will handle simple feed message with all the template options possible ", async () => {
    const [connection, intent] = createFeed({
      template: `$FEEDNAME $FEEDURL $FEEDTITLE $TITLE $LINK $AUTHOR $DATE $SUMMARY`,
    });
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.body).to.equal(
      "Test feed https://example.com/feed.xml Test feed Foo [Foo](foo/bar) Me! today! fibble fobble",
    );
  });

  it("will handle html in the feed summary ", async () => {
    const [connection, intent] = createFeed({
      template: `$FEEDNAME $SUMMARY`,
    });
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      summary:
        "<p> Some HTML with <disallowed-elements> which should be ignored </disallowed-elements> and an <img src='mxc://fibble/fobble'></img> </p>",
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.body).to.equal(
      'Test feed <p> Some HTML with  which should be ignored  and an <img src="mxc://fibble/fobble"> </p>',
    );
  });

  it("will handle partial html in the feed summary ", async () => {
    const [connection, intent] = createFeed({
      template: `$FEEDNAME $SUMMARY`,
    });
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      summary:
        "<p> Some HTML with <disallowed-elements> which should be ignored and an <img src='mxc://fibble/fobble'></img> </p>",
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.body).to.equal(
      'Test feed <p> Some HTML with  which should be ignored and an <img src="mxc://fibble/fobble"> </p>',
    );
  });

  it("will render block html in the formatted summary", async () => {
    const [connection, intent] = createFeed({
      template: `$SUMMARY`,
    });
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      summary:
        "<ul><li><a href='https://example.com/1'>One</a></li><li><a href='https://example.com/2'>Two</a></li></ul>",
    });
    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.roomId).to.equal(ROOM_ID);
    expect(matrixEvt.content.body).to.equal(
      '<ul><li><a href="https://example.com/1">One</a></li><li><a href="https://example.com/2">Two</a></li></ul>',
    );
    expect(matrixEvt.content.formatted_body).to.include("<ul>");
    expect(matrixEvt.content.formatted_body).to.include("<li>");
  });

  it("will upload summary images and replace them with mxc urls", async () => {
    const [connection, intent] = createFeed({
      template: `$SUMMARY`,
    });
    const axiosGet = axios.get;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (axios.get as any) = async () => ({
      data: Buffer.from("fake-image"),
      headers: {
        "content-type": "image/jpeg",
      },
    });
    try {
      await connection.handleFeedEntry({
        ...FEED_ENTRY_DEFAULTS,
        summary:
          '<div><a href="https://example.com/comic"><img src="https://example.com/image.jpg"></a></div>',
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (axios.get as any) = axiosGet;
    }

    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.content.body).to.equal(
      '<div><a href="https://example.com/comic"><img src="mxc://upload/1"></a></div>',
    );
    expect(matrixEvt.content.formatted_body).to.include('src="mxc://upload/1"');
    expect(intent.underlyingClient.uploadedContent).to.have.lengthOf(1);
  });

  it("will fallback to default template when configured template is empty", async () => {
    const [connection, intent] = createFeed({
      template: `$SUMMARY`,
    });
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      summary: null,
    });

    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.content.body).to.equal("New post in Test feed: [Foo](foo/bar)");
    expect(matrixEvt.content.formatted_body).to.include(
      '<a href="foo/bar">Foo</a>',
    );
  });

  it("will fallback to title template when link is missing", async () => {
    const [connection, intent] = createFeed({
      template: `$SUMMARY`,
    });
    await connection.handleFeedEntry({
      ...FEED_ENTRY_DEFAULTS,
      summary: null,
      link: null,
    });

    const matrixEvt = intent.sentEvents[0];
    expect(matrixEvt).to.not.be.undefined;
    expect(matrixEvt.content.body).to.equal("New post in Test feed: Foo");
  });
});
