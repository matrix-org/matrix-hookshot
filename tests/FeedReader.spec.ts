import { AxiosResponse, AxiosStatic } from "axios";
import { expect } from "chai";
import EventEmitter from "events";
import { BridgeConfigFeeds } from "../src/Config/Config";
import { ConnectionManager } from "../src/ConnectionManager";
import { IConnection } from "../src/Connections";
import { FeedEntry, FeedReader } from "../src/feeds/FeedReader";
import { MessageQueue, MessageQueueMessage } from "../src/MessageQueue";

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

class MockHttpClient {
    constructor(public response: AxiosResponse) {}

    get(): Promise<AxiosResponse> {
        return Promise.resolve(this.response);
    }
}

function constructFeedReader(feedResponse: () => {headers: Record<string,string>, data: string}) {
    const config = new BridgeConfigFeeds({
        enabled: true,
        pollIntervalSeconds: 1,
        pollTimeoutSeconds: 1,
    });
    const cm = new MockConnectionManager([{ feedUrl: 'http://test/' } as unknown as IConnection]) as unknown as ConnectionManager
    const mq = new MockMessageQueue();
    const feedReader = new FeedReader(
        config, cm, mq,
        {
            getAccountData: <T>() => Promise.resolve({ 'http://test/': [] } as unknown as T),
            setAccountData: () => Promise.resolve(),
        },
        new MockHttpClient({ ...feedResponse() } as AxiosResponse) as unknown as AxiosStatic,
    );
    return {config, cm, mq, feedReader};   
}

describe("FeedReader", () => {
    it("should correctly handle empty titles", async () => {
        const { mq, feedReader} = constructFeedReader(() => ({
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

        const event: any = await new Promise((resolve) => {
            mq.on('pushed', (data) => { resolve(data); feedReader.stop() });
        });

        expect(event.eventName).to.equal('feed.entry');
        expect(event.data.feed.title).to.equal(null);
        expect(event.data.title).to.equal(null);
    });
    it("should handle feeds", async () => {
        const { mq, feedReader} = constructFeedReader(() => ({
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

        const event: MessageQueueMessage<FeedEntry> = await new Promise((resolve) => {
            mq.on('pushed', (data) => { resolve(data); feedReader.stop() });
        });

        expect(event.eventName).to.equal('feed.entry');
        expect(event.data.feed.title).to.equal('Example Feed');
        expect(event.data.author).to.equal('John Doe');
        expect(event.data.summary).to.equal('Some text.');
        expect(event.data.link).to.equal('http://example.org/2003/12/13/atom03');
        expect(event.data.pubdate).to.equal('Sat, 13 Dec 2003 18:30:02 +0000');
    });
});
