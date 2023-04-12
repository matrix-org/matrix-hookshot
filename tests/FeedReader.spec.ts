import { AxiosResponse, AxiosStatic } from "axios";
import { expect } from "chai";
import EventEmitter from "events";
import { BridgeConfigFeeds } from "../src/Config/Config";
import { ConnectionManager } from "../src/ConnectionManager";
import { IConnection } from "../src/Connections";
import { FeedReader } from "../src/feeds/FeedReader";
import { MessageQueue, MessageQueueMessage } from "../src/MessageQueue";

class MockConnectionManager extends EventEmitter {
    constructor(
        public connections: IConnection[]
    ) {
        super();
    }
    
    getAllConnectionsOfType(type: unknown) {
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

    async pushWait<T, X>(data: MessageQueueMessage<T>, timeout?: number, single?: boolean): Promise<X> {
        throw new Error('Not yet implemented');
    }
}

class MockHttpClient {
    constructor(public response: AxiosResponse) {}

    get(): Promise<AxiosResponse> {
        return Promise.resolve(this.response);
    }
}

describe("FeedReader", () => {
    it("should correctly handle empty titles", async () => {
        const config = new BridgeConfigFeeds({
            enabled: true,
            pollIntervalSeconds: 1,
            pollTimeoutSeconds: 1,
        });
        const cm = new MockConnectionManager([{ feedUrl: 'http://test/' } as unknown as IConnection]) as unknown as ConnectionManager
        const mq = new MockMessageQueue();

        const feedContents = `
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
        `;

        const feedReader = new FeedReader(
            config, cm, mq,
            {
                getAccountData: <T>() => Promise.resolve({ 'http://test/': [] } as unknown as T),
                setAccountData: <T>() => Promise.resolve(),
            },
            new MockHttpClient({ headers: {}, data: feedContents } as AxiosResponse) as unknown as AxiosStatic,
        );

        const event: any = await new Promise((resolve) => {
            mq.on('pushed', (data, _) => { resolve(data); feedReader.stop() });
        });

        expect(event.eventName).to.equal('feed.entry');
        expect(event.data.feed.title).to.equal(null);
        expect(event.data.title).to.equal(null);
    });
});
