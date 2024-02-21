import { expect } from "chai";
import EventEmitter from "events";
import { BridgeConfigFeeds } from "../src/config/Config";
import { ConnectionManager } from "../src/ConnectionManager";
import { IConnection } from "../src/Connections";
import { FeedEntry, FeedReader } from "../src/feeds/FeedReader";
import { MessageQueue, MessageQueueMessage } from "../src/MessageQueue";
import { MemoryStorageProvider } from "../src/Stores/MemoryStorageProvider";
import { Server, createServer } from 'http';
import { AddressInfo } from "net";

class MockConnectionManager extends EventEmitter {
    constructor(
        public connections: IConnection[]
    ) {
        super();
    }
    
    getAllConnectionsOfType() {
        return this.connections;
    }
}

class MockMessageQueue extends EventEmitter implements MessageQueue {
    subscribe(eventGlob: string): void {
        this.emit('subscribed', eventGlob);
    }

    unsubscribe(eventGlob: string): void {
        this.emit('unsubscribed', eventGlob);
    }

    async push(data: MessageQueueMessage<unknown>, single?: boolean): Promise<void> {
        this.emit('pushed', data, single);
    }

    async pushWait<X>(): Promise<X> {
        throw new Error('Not yet implemented');
    }
}

async function constructFeedReader(feedResponse: () => {headers: Record<string,string>, data: string}) {
    const httpServer = await new Promise<Server>(resolve => {
        const srv = createServer((_req, res) => {
            res.writeHead(200);
            const { headers, data } = feedResponse();
            Object.entries(headers).forEach(([key,value]) => {
                res.setHeader(key, value);
            });
            res.write(data);
            res.end();
        }).listen(0, '127.0.0.1', () => {
            resolve(srv);
        });
    });
    const address = httpServer.address() as AddressInfo;
    const feedUrl = `http://127.0.0.1:${address.port}/`
    const config = new BridgeConfigFeeds({
        enabled: true,
        pollIntervalSeconds: 1,
        pollTimeoutSeconds: 1,
    });
    const cm = new MockConnectionManager([{ feedUrl } as unknown as IConnection]) as unknown as ConnectionManager
    const mq = new MockMessageQueue();
    const events: MessageQueueMessage<FeedEntry>[] = [];
    mq.on('pushed', (data) => { if (data.eventName === 'feed.entry') {events.push(data);} });

    const storage = new MemoryStorageProvider();
    // Ensure we don't initial sync by storing a guid.
    await storage.storeFeedGuids(feedUrl, '-test-guid-');
    const feedReader = new FeedReader(
        config, cm, mq, storage,
    );
    after(() => httpServer.close());
    return {config, cm, events, feedReader, feedUrl, httpServer, storage};   
}

describe("FeedReader", () => {
    it("should correctly handle empty titles", async () => {
        const { events, feedReader, feedUrl } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="UTF-8"?>
            <rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
            <channel><title type='text'></title><description>test feed</description><link>http://test/</link>
            <pubDate>Wed, 12 Apr 2023 09:53:00 GMT</pubDate>
            <item>
                <title type='text'></title><description>test item</description>
                <link>http://example.com/test/1681293180</link>
                <guid isPermaLink="true">http://example.com/test/1681293180</guid>
                <pubDate>Wed, 12 Apr 2023 09:53:00 GMT</pubDate>
            </item>
            </channel></rss>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        expect(events).to.have.lengthOf(1);

        expect(events[0].data.feed.title).to.equal(null);
        expect(events[0].data.title).to.equal(null);
    });
    it("should handle RSS 2.0 feeds", async () => {
        const { events, feedReader, feedUrl } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="UTF-8" ?>
                <rss version="2.0">
                <channel>
                    <title>RSS Title</title>
                    <description>This is an example of an RSS feed</description>
                    <link>http://www.example.com/main.html</link>
                    <copyright>2020 Example.com All rights reserved</copyright>
                    <lastBuildDate>Mon, 6 Sep 2010 00:01:00 +0000</lastBuildDate>
                    <pubDate>Sun, 6 Sep 2009 16:20:00 +0000</pubDate>
                    <ttl>1800</ttl>
                    <item>
                        <title>Example entry</title>
                        <author>John Doe</author>
                        <description>Here is some text containing an interesting description.</description>
                        <link>http://www.example.com/blog/post/1</link>
                        <guid isPermaLink="false">7bd204c6-1655-4c27-aeee-53f933c5395f</guid>
                        <pubDate>Sun, 6 Sep 2009 16:20:00 +0000</pubDate>
                    </item>
                </channel>
            </rss>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        expect(events).to.have.lengthOf(1);

        expect(events[0].data.feed.title).to.equal('RSS Title');
        expect(events[0].data.author).to.equal('John Doe');
        expect(events[0].data.title).to.equal('Example entry');
        expect(events[0].data.summary).to.equal('Here is some text containing an interesting description.');
        expect(events[0].data.link).to.equal('http://www.example.com/blog/post/1');
        expect(events[0].data.pubdate).to.equal('Sun, 6 Sep 2009 16:20:00 +0000');
    });
    it("should handle RSS feeds with a permalink url", async () => {
        const { events, feedReader, feedUrl } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="UTF-8" ?>
                <rss version="2.0">
                <channel>
                    <title>RSS Title</title>
                    <description>This is an example of an RSS feed</description>
                    <link>http://www.example.com/main.html</link>
                    <copyright>2020 Example.com All rights reserved</copyright>
                    <lastBuildDate>Mon, 6 Sep 2010 00:01:00 +0000</lastBuildDate>
                    <pubDate>Sun, 6 Sep 2009 16:20:00 +0000</pubDate>
                    <ttl>1800</ttl>
                    <item>
                        <title>Example entry</title>
                        <author>John Doe</author>
                        <description>Here is some text containing an interesting description.</description>
                        <guid isPermaLink="true">http://www.example.com/blog/post/1</guid>
                        <pubDate>Sun, 6 Sep 2009 16:20:00 +0000</pubDate>
                    </item>
                </channel>
            </rss>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        expect(events).to.have.lengthOf(1);

        expect(events[0].data.feed.title).to.equal('RSS Title');
        expect(events[0].data.author).to.equal('John Doe');
        expect(events[0].data.title).to.equal('Example entry');
        expect(events[0].data.summary).to.equal('Here is some text containing an interesting description.');
        expect(events[0].data.link).to.equal('http://www.example.com/blog/post/1');
        expect(events[0].data.pubdate).to.equal('Sun, 6 Sep 2009 16:20:00 +0000');
    });
    it("should handle Atom feeds", async () => {
        const { events, feedReader, feedUrl } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
            
              <title>Example Feed</title>
              <link href="http://example.org/"/>
              <updated>2003-12-13T18:30:02Z</updated>
              <author>
                <name>John Doe</name>
              </author>
              <id>urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6</id>
            
              <entry>
                <author>
                    <name>John Doe</name>
                </author>
                <title>Atom-Powered Robots Run Amok</title>
                <link href="http://example.org/2003/12/13/atom03"/>
                <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
                <updated>2003-12-13T18:30:02Z</updated>
                <summary>Some text.</summary>
              </entry>
            
            </feed>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        expect(events).to.have.lengthOf(1);

        expect(events[0].data.feed.title).to.equal('Example Feed');
        expect(events[0].data.title).to.equal('Atom-Powered Robots Run Amok');
        expect(events[0].data.author).to.equal('John Doe');
        expect(events[0].data.summary).to.equal('Some text.');
        expect(events[0].data.link).to.equal('http://example.org/2003/12/13/atom03');
        expect(events[0].data.pubdate).to.equal('Sat, 13 Dec 2003 18:30:02 +0000');
    });
    it("should not duplicate feed entries", async () => {
        const { events, feedReader, feedUrl } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <author>
                    <name>John Doe</name>
                </author>
                <title>Atom-Powered Robots Run Amok</title>
                <link href="http://example.org/2003/12/13/atom03"/>
                <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
                <updated>2003-12-13T18:30:02Z</updated>
                <summary>Some text.</summary>
              </entry>
            </feed>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        await feedReader.pollFeed(feedUrl);
        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        expect(events).to.have.lengthOf(1);
    });
    it("should always hash to the same value for Atom feeds", async () => {
        const expectedHash = ['md5:d41d8cd98f00b204e9800998ecf8427e'];
        const { feedReader, feedUrl, storage } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <title>Atom-Powered Robots Run Amok</title>
                <link href="http://example.com/test/123"/>
                <guid isPermaLink="true">http://example.com/test/123</guid>
              </entry>
            </feed>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        const items = await storage.hasSeenFeedGuids(feedUrl, ...expectedHash);
        expect(items).to.deep.equal(expectedHash);
    });
    it("should always hash to the same value for RSS feeds", async () => {
        const expectedHash = [
            'md5:98bafde155b931e656ad7c137cd7711e', // guid
            'md5:72eec3c0d59ff91a80f0073ee4f8511a', // link
            'md5:7c5dd7e5988ff388ab2a402ce7feb2f0', // title
        ];
        const { feedReader, feedUrl, storage } = await constructFeedReader(() => ({
            headers: {}, data: `
            <?xml version="1.0" encoding="UTF-8" ?>
                <rss version="2.0">
                <channel>
                    <title>RSS Title</title>
                    <description>This is an example of an RSS feed</description>
                    <item>
                        <title>Example entry</title>
                        <guid isPermaLink="true">http://www.example.com/blog/post/1</guid>
                    </item>
                    <item>
                        <title>Example entry</title>
                        <link>http://www.example.com/blog/post/2</link>
                    </item>
                    <item>
                        <title>Example entry 3</title>
                    </item>
                </channel>
            </rss>
        `
        }));

        await feedReader.pollFeed(feedUrl);
        feedReader.stop();
        const items = await storage.hasSeenFeedGuids(feedUrl, ...expectedHash);
        expect(items).to.deep.equal(expectedHash);
    });
});
