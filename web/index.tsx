import { render } from 'preact';
import 'preact/devtools';
import App from './App';
import "./fonts/fonts.scss"
import "./styling.scss";
import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import '@vector-im/compound-web/dist/style.css';

const [ root ] = document.getElementsByTagName('main');

if (root) {
  render(<App />, root);
}