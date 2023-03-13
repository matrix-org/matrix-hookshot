import "./fonts/fonts.scss"
import "./styling.scss";
import "./oauth.scss";
import { render } from 'preact';
import 'preact/devtools';

const root = document.getElementsByTagName('main')[0];

const ServiceToName: Record<string,string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    default: ''
}


function RenderOAuth() {
    const params = new URLSearchParams(window.location.search);
    const service = params.get('service') ?? 'default';
    const error = params.get('error');
    const errcode = params.get('errcode');
    const oauthKind = params.get('oauth-kind') ?? 'account';

    if (error) {
        return <>
            <h1>Could not connect your { ServiceToName[service] } {oauthKind} to Hookshot.</h1>
            <p>
                <code>{errcode}</code> {error}
            </p>
        </>;
    }

    if (oauthKind === 'app-install') {}

    return <>
        <h1> Your { ServiceToName[service] } {oauthKind} has been connected to Hookshot. </h1>
        <p>You may close this window.</p>
    </>;
}

if (root) {
  render(<RenderOAuth />, root);
}