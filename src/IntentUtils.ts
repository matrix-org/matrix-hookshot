import LogWrapper from "./LogWrapper";
import { Octokit } from "@octokit/rest";
import { Appservice } from "matrix-bot-sdk";

const log = new LogWrapper("IntentUtils");

export async function getIntentForUser(user: Octokit.IssuesGetResponseUser, as: Appservice, octokit: Octokit) {
    const intent = as.getIntentForSuffix(user.login);
    const displayName = `${user.login}`;
    // Verify up-to-date profile
    let profile;
    await intent.ensureRegistered();
    try {
        profile = await intent.underlyingClient.getUserProfile(intent.userId);
    } catch (ex) {
        profile = {};
    }

    if (profile.displayname !== displayName) {
        log.debug(`Updating ${intent.userId}'s displayname`);
        log.info(`${intent.userId}'s profile is out of date`);
        await intent.underlyingClient.setDisplayName(displayName);
    }

    if (!profile.avatar_url && user.avatar_url) {
        log.debug(`Updating ${intent.userId}'s avatar`);
        const buffer = await octokit.request(user.avatar_url);
        log.info(`uploading ${user.avatar_url}`);
        // This does exist, but headers is silly and doesn't have content-type.
        // tslint:disable-next-line: no-any
        const contentType = (buffer.headers as any)["content-type"];
        const mxc = await intent.underlyingClient.uploadContent(
            Buffer.from(buffer.data as ArrayBuffer),
            contentType,
        );
        await intent.underlyingClient.setAvatarUrl(mxc);

    }

    return intent;
}