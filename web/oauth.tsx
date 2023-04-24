import "./fonts/fonts.scss"
import "./styling.scss";
import "./oauth.scss";
import { render } from 'preact';
import 'preact/devtools';
import type { OAuthPageParams } from '../src/Webhooks';

const root = document.getElementsByTagName('main')[0];

const ServiceToName: Record<string,string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    default: ''
}


function RenderOAuth() {
    const params = new URLSearchParams(window.location.search);
    const service = (params.get('service') as OAuthPageParams['service']) ?? 'default';
    const error = (params.get('error') as OAuthPageParams['error']);
    const errcode = (params.get('errcode') as OAuthPageParams['errcode']);
    const oauthKind = (params.get('oauth-kind') as OAuthPageParams['oauth-kind']) ?? 'account';
    const result = (params.get('result') as OAuthPageParams['result']);

    const serviceName = ServiceToName[service];

    if (result === 'error') {
        return <>
            <h1>Could not connect your { serviceName } { oauthKind } to Hookshot.</h1>
            <p>
                <code>{errcode}</code> {error}
            </p>
        </>;
    // Pending / update are mostly the same thing. Pending means a new app install, update means updating the existing app install.
    } else if (result === 'pending' || result === 'update') {
        return <>
            <h1>The connection to your { serviceName } { oauthKind } is pending.</h1>
            <p>
                You will need to wait for an administrator of the { serviceName } {oauthKind} instance to approve
                the new installation. If you think this is a mistake, contact the administrator of your organisation.
            </p>
        </>;
    } else if (result === 'success') {
        return <>
            <h1>Your { serviceName } {oauthKind} has been connected.</h1>
            <p>You may close this window.</p>
        </>;
    }
    return <>
        <h1>The connection to your { serviceName } { oauthKind } is { result }.</h1>
        <p>
            This is an unknown state, you may need to contact your systems administrator.
        </p>
    </>;

}

if (root) {
  render(<RenderOAuth />, root);
}
