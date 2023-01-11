import { render } from 'preact';
import 'preact/devtools';
import App from './App';
import "./fonts/fonts.scss"
import "./styling.scss";

const root = document.getElementsByTagName('main')[0];

if (root) {
  render(<App />, root);
}