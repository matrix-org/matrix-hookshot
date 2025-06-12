# Element Module

<section class="warning">
Element Modules are very much in the early stages of development, and Hookshot is using bleeding edge APIs.
Please be aware that breakages are likely until the APIs become more stable.
</section>

Hookshot provides a module that can be used by Element Web / Element Desktop to render
additional information below an event that has come from Hookshot. You will need to be
able to edit your Element's `config.json` for this feature to work.

This may be enabled by adding the module's URL to your Element Web `config.json` file.
See [Element Web's documentation](https://github.com/element-hq/element-web/blob/develop/docs/config.md) for how this works.

The Hookshot module will be found under `/elementModule/index.mjs` on the `widgets` listener. For instance
if you host your widgets listener on `https://hookshot.example.org/widgets` then the path would be `https://hookshot.example.org/widgets/elementModule/index.mjs`.

At the time of writing, this is supported for a subset of integrations:

- OpenProject: Work package previews.
