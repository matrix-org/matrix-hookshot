import { expect } from "chai";
import { GithubInstance } from "../../src/github/GithubInstance"; 
import { GITHUB_CLOUD_URL } from "../../src/github/GithubInstance";

describe("GitHub", () => {
    describe("AdminCommands", () => {
        it("can generate an authorize URL for the cloud URL", () => {
			expect(
				GithubInstance.generateOAuthUrl(GITHUB_CLOUD_URL, "authorize", {
					state: "my_state",
					client_id: "123",
					redirect_uri: "456",
				})
			).equals('https://github.com/login/oauth/authorize?state=my_state&client_id=123&redirect_uri=456');
        });

        it("can generate an authorize URL for enterprise URLs", () => {
			expect(
				GithubInstance.generateOAuthUrl(new URL("https://mygithuburl.com/foo/bar"), "authorize", {
					state: "my_state",
					client_id: "123",
					redirect_uri: "456",
				})
			).equals('https://mygithuburl.com/foo/bar/login/oauth/authorize?state=my_state&client_id=123&redirect_uri=456');
        });

        it("can generate an access_token URL for the cloud URL", () => {
			expect(
				GithubInstance.generateOAuthUrl(GITHUB_CLOUD_URL, "access_token", {
					client_id: "123",
					client_secret: "the-secret",
					code: "the-code",
					redirect_uri: "456",
					state: "my_state",
				})
			).equals('https://github.com/login/oauth/access_token?client_id=123&client_secret=the-secret&code=the-code&redirect_uri=456&state=my_state');
        });

        it("can generate an access_token URL for enterprise URLs", () => {
			expect(
				GithubInstance.generateOAuthUrl(new URL("https://mygithuburl.com/foo/bar"), "access_token", {
					client_id: "123",
					client_secret: "the-secret",
					code: "the-code",
					redirect_uri: "456",
					state: "my_state",
				})
			).equals('https://mygithuburl.com/foo/bar/login/oauth/access_token?client_id=123&client_secret=the-secret&code=the-code&redirect_uri=456&state=my_state');
        });
    });
});