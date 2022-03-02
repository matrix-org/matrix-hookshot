import { h, render } from 'preact';
import "@fontsource/open-sans/files/open-sans-latin-400-normal.woff2";

const root = document.getElementsByTagName('main')[0];

function App() {
  const params = new URLSearchParams(window.location.search);

  // Both strings contain extra quotes
  const applinkStartingUrl = params.get('applinkStartingUrl')?.replace(/"/g, '');
  const applinkOriginalCreatedId = params.get('applinkOriginalCreatedId')?.replace(/"/g, '');

  if (!applinkStartingUrl) {
    return <b> Misconfigured URL </b>;
  }

  if (!applinkOriginalCreatedId) {
    return <b> Misconfigured URL </b>;
  }

  const iframeSrc = `${applinkStartingUrl}/plugins/servlet/applinks/auth/conf/oauth/add-consumer-by-url/${applinkOriginalCreatedId}/INBOUND?oauth-incoming-enabled=true&uiposition=null&hostUrl=http%3A%2F%2Flocalhost%3A5065%2Fjira&enable-oauth=true&success=true`

  return <section>
      <h1>Confirm Hookshot JIRA integration</h1>
      <p></p>
      <code>{iframeSrc}</code>
      <iframe sandbox="allow-scripts" src={iframeSrc}/>
    </section>;
}

if (root) {
  render(<App />, root);
}