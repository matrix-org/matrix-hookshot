import { randomBytes } from "crypto";
import { LocalMQ as JsLocalMQ } from "../src/MessageQueue/LocalMQ";
import { LocalMQ as RsLocalMQ } from "../src/libRs";

async function testSimpleEvent(mq: JsLocalMQ|RsLocalMQ, iterations: number ) {
    mq.subscribe("test");
    let o = { resolver: (n = 1) => {} }
    mq.on('test', (_, d) => { o.resolver(d) });
    for (let index = 0; index < iterations; index++) {
        const res = new Promise((resolve) => o.resolver = resolve as any);
        await mq.push({
            sender: "hi",
            eventName: "test",
            data: {},
            id: "hi",
        });
        console.log(await res);        
    }
}

async function testWithData(mq: JsLocalMQ|RsLocalMQ, iterations: number ) {
    mq.subscribe("test");
    let o = { resolver: (n = 1) => {} }
    mq.on('test', (_, d) => { o.resolver(d) });
    for (let index = 0; index < iterations; index++) {
        const res = new Promise((resolve) => o.resolver = resolve as any);
        const data = {
            data: randomBytes(512).toJSON()
        };
        await mq.push({
            sender: "hi",
            eventName: "test",
            data: data,
            id: "hi",
        });
        console.log(await res);  
    }
}

const jsMq = new JsLocalMQ();
const rsMq = new RsLocalMQ();

async function main() {
    console.time('JS:testSimpleEvent');
    await testSimpleEvent(jsMq, 1000);
    console.timeEnd('JS:testSimpleEvent');
    console.time('RS:testSimpleEvent');
    await testSimpleEvent(rsMq, 1000);
    console.timeEnd('RS:testSimpleEvent');

    console.time('JS:testWithData');
    await testWithData(jsMq, 100);
    console.timeEnd('JS:testWithData');
    console.time('RS:testWithData');
    await testWithData(rsMq, 100);
    console.timeEnd('RS:testWithData');
}

main().finally(() => {
    console.log('Done!');
})