import { h, render } from 'preact';
import 'preact/devtools';
import App from './App';

const root = document.getElementById('root')

if (root) {
  render(<App />, root);
}