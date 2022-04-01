import { h, render } from 'preact';
import 'preact/devtools';
import App from './App';
import "@fontsource/open-sans/400.css";
import "./fonts/fonts.scss"
import "./styling.scss";

const root = document.getElementsByTagName('main')[0];

if (root) {
  render(<App />, root);
}