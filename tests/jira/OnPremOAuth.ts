import { expect } from "chai";
import {
    assertOAuthRequestToken,
    buildAuthorizationHeaders,
    makeArrayOfArgumentsHash,
    nonce,
    normalizeRequestParams,
    normalizeUrl,
    sortRequestParams,
    usesCustomPort,
} from "../../src/Jira/oauth/OnPremOAuth";

describe("JiraOnPremOAuth", () => {
    describe("assertOAuthRequestToken", () => {
        const DATA = {
            oauth_token: "abc",
            oauth_token_secret: "abc",
        };
        it("forwards a valid API responses", () => {
            expect(assertOAuthRequestToken(DATA)).to.deep.equal(DATA);
        });
        it("discards additional properties", () => {
            expect(assertOAuthRequestToken({
                ...DATA,
                foo: 'bar',
            })).to.deep.equal(DATA);
        });
        it("throws when oauth_token is invalid", () => {
            expect(assertOAuthRequestToken({
                oauth_token: "",
                oauth_token_secret: "abc",
            })).to.throw;
            expect(assertOAuthRequestToken({
                oauth_token_secret: "abc",
            })).to.throw;
        });
        it("throws when oauth_token_secret is invalid", () => {
            expect(assertOAuthRequestToken({
                oauth_token: "abc",
                oauth_token_secret: "",
            })).to.throw;
            expect(assertOAuthRequestToken({
                oauth_token: "abc",
            })).to.throw;
        });
    });
    describe("buildAuthorizationHeaders", () => {
        it("discards additional properties not starting with oauth_", () => {
            expect(buildAuthorizationHeaders([
                ["foo", "bar"],
                ["oauth_token", "abc"],
                ["oauth_token_secret", "abc"],
            ])).to.equal(`OAuth oauth_token="abc",oauth_token_secret="abc"`);
        });
        it("encodes params", () => {
            expect(buildAuthorizationHeaders([
                ["oauth_token", "abc)def"],
            ])).to.equal(`OAuth oauth_token="abc%29def"`);
        });
        it("does not pollute the Object.prototype", () => {
            const objectPrototype = Object.prototype;
            buildAuthorizationHeaders([
                ["__proto__", "test"],
            ])
            expect(Object.prototype).to.equal(objectPrototype);
        });
    });
    describe("makeArrayOfArgumentsHash", () => {
        it("processes strings and arrays of strings", () => {
            expect(makeArrayOfArgumentsHash(new Map<string, string|string[]>([
                ["foo", "bar"],
                ["a", ["b", "c", "d"]],
            ]))).to.deep.equal([
                ["foo", "bar"],
                ["a", "b"],
                ["a", "c"],
                ["a", "d"],
            ]);
        });
    });
    describe("nonce", () => {
        it("returns 32 characters by default", () => {
            const actual = nonce();
            expect(actual).to.be.a.string;
            expect(actual).to.have.length(32);
        });
        it("returns strings of the specified length", () => {
            expect(nonce(1)).to.have.length(1);
            expect(nonce(10)).to.have.length(10);
            expect(nonce(100)).to.have.length(100);
            expect(nonce(128)).to.have.length(128);
        });
    });
    describe("normalizeUrl", () => {
        it("removes unnecessary port declarations", () => {
            expect(normalizeUrl("http://example:80/")).to.equal("http://example/");
            expect(normalizeUrl("http://example:8080/")).to.equal("http://example:8080/");
            expect(normalizeUrl("https://example:443/")).to.equal("https://example/");
            expect(normalizeUrl("https://example:8443/")).to.equal("https://example:8443/");
        });
        it("normalizes an empty path to '/'", () => {
            expect(normalizeUrl("http://example")).to.equal("http://example/");
            expect(normalizeUrl("https://example")).to.equal("https://example/");
            expect(normalizeUrl("http://example/")).to.equal("http://example/");
            expect(normalizeUrl("http://example/foo/bar")).to.equal("http://example/foo/bar");
        });
        it("removes the search query", () => {
            expect(normalizeUrl("https://example/?hello=world")).to.equal("https://example/");
            expect(normalizeUrl("https://example/foo/bar?hello=world")).to.equal("https://example/foo/bar");
        });
    });
    describe("normalizeRequestParams", () => {
        const a: [string, string] = ["aachen", "dom"];
        const b: [string, string] = ["berlin", "fernsehturm"];
        const c: [string, string] = ["cologne", "maus"];
        const d: [string, string] = ["dortmund", "Universität"];
        it("sorts them alphabetically", () => {
            expect(normalizeRequestParams(new Map([a, b]))).to.equal("aachen=dom&berlin=fernsehturm");
            expect(normalizeRequestParams(new Map([b, a]))).to.equal("aachen=dom&berlin=fernsehturm");
            expect(normalizeRequestParams(new Map([a, c]))).to.equal("aachen=dom&cologne=maus");
            expect(normalizeRequestParams(new Map([c, a]))).to.equal("aachen=dom&cologne=maus");
        });
        it("url-encodes values", () => {
            expect(normalizeRequestParams(new Map([d]))).to.equal("dortmund=Universit%C3%A4t");
        });
        it("handles different amounts of pairs", () => {
            expect(normalizeRequestParams(new Map([a]))).to.equal("aachen=dom");
            expect(normalizeRequestParams(new Map([a, b]))).to.equal("aachen=dom&berlin=fernsehturm");
            expect(normalizeRequestParams(
                new Map([a, b, c]))
            ).to.equal("aachen=dom&berlin=fernsehturm&cologne=maus");
            expect(normalizeRequestParams(
                new Map([a, b, c, d]))
            ).to.equal("aachen=dom&berlin=fernsehturm&cologne=maus&dortmund=Universit%C3%A4t");
        });
    });
    describe("sortRequestParams", () => {
        it("correctly sorts request params", () => {
            const a: [string, string] = ["aachen", "dom"];
            const b: [string, string] = ["aachen", "rathaus"];
            const c: [string, string] = ["berlin", "fernsehturm"];
            const d: [string, string] = ["berlin", "rotes rathaus"];
            expect(sortRequestParams([a, b, c, d])).to.deep.equal([a, b, c, d]);
            expect(sortRequestParams([d, c, b, a])).to.deep.equal([a, b, c, d]);
            expect(sortRequestParams([c, b, a, d])).to.deep.equal([a, b, c, d]);
            expect(sortRequestParams([a, b, a, d])).to.deep.equal([a, a, b, d]);
        });
    });
    describe("usesCustomPort", () => {
        it("returns true for a non-default HTTP port", () => {
            expect(usesCustomPort(new URL('http://example.com:8008'))).to.be.true;
            expect(usesCustomPort(new URL('http://example.com:8080'))).to.be.true;
        });
        it("returns true for a non-default HTTPS port", () => {
            expect(usesCustomPort(new URL('https://example.com:1234'))).to.be.true;
            expect(usesCustomPort(new URL('https://example.com:8443'))).to.be.true;
        });
        it("returns false when no port is specified", () => {
            expect(usesCustomPort(new URL('http://example.com'))).to.be.false;
        });
        it("returns false for default ports", () => {
            expect(usesCustomPort(new URL('http://example.com:80'))).to.be.false;
            expect(usesCustomPort(new URL('https://example.com:443'))).to.be.false;
        });
    });
});
