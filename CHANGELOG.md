1.5.0 (2022-04-14)
==================

Features
--------

- Allow specifying msgtype for generic webhook transformations. ([\#282](https://github.com/matrix-org/matrix-hookshot/issues/282))
- Add new GitHubRepo config option `newIssue.labels` which allows admins to automatically set labels on new issues. ([\#292](https://github.com/matrix-org/matrix-hookshot/issues/292))
- Allow priority ordering of connections by setting a `priorty: number` key in the state event content. ([\#293](https://github.com/matrix-org/matrix-hookshot/issues/293))
- Support GitLab `push` webhook events ([\#306](https://github.com/matrix-org/matrix-hookshot/issues/306))


Bugfixes
--------

- Fix #289 "Generic webhook url format (copy) issue with backticks" ([\#290](https://github.com/matrix-org/matrix-hookshot/issues/290))
- Fix `!hookshot help` appearing twice in help text, and only show setup commands for which the bridge is configured for. ([\#296](https://github.com/matrix-org/matrix-hookshot/issues/296))
- Fix GitHub / GitLab issue rooms breaking due to being unable to generate ghost users. ([\#303](https://github.com/matrix-org/matrix-hookshot/issues/303))
- Fix GitHub tokens not being refreshed on expiry when using OAuth support.
  Rename the `github hastoken` to `github status`. ([\#307](https://github.com/matrix-org/matrix-hookshot/issues/307))


Improved Documentation
----------------------

- Fix some typos in widgets.md ([\#286](https://github.com/matrix-org/matrix-hookshot/issues/286))


Internal Changes
----------------

- Fix issue where the webhook icon in the widget configuration page would not load in some browsers. ([\#285](https://github.com/matrix-org/matrix-hookshot/issues/285))
- Fail to start when widgets are configured but no "widgets" listener is configured. ([\#298](https://github.com/matrix-org/matrix-hookshot/issues/298))


1.4.0 (2022-04-08)
==================

Features
--------

- Add support for configuring generic webhooks via widgets. ([\#140](https://github.com/matrix-org/matrix-hookshot/issues/140))
- Show the closing comments on closed GitHub PRs. ([\#262](https://github.com/matrix-org/matrix-hookshot/issues/262))
- Webhooks created via `!hookshot webhook` now have their secret URLs sent to the admin room with the user, rather than posted in the bridged room. ([\#265](https://github.com/matrix-org/matrix-hookshot/issues/265))
- Automatically link GitHub issues and pull requests when an issue number is mentioned (by default, using the # prefix). ([\#277](https://github.com/matrix-org/matrix-hookshot/issues/277))
- Support GitLab release webhook events. ([\#278](https://github.com/matrix-org/matrix-hookshot/issues/278))


Bugfixes
--------

- Bridge API: Don't sent HTTP header Content-Type: application/json when there is no body. ([\#272](https://github.com/matrix-org/matrix-hookshot/issues/272))


Improved Documentation
----------------------

- Clarify steps of bridging a GitHub repo ([\#245](https://github.com/matrix-org/matrix-hookshot/issues/245))
- Update setup.md: Minor grammar corrections ([\#264](https://github.com/matrix-org/matrix-hookshot/issues/264))


Internal Changes
----------------

- Make some grammar corrections in code, chat notices and documentation. ([\#267](https://github.com/matrix-org/matrix-hookshot/issues/267))
- Made ESLint lint all TypeScript files and fix a few linter errors. ([\#273](https://github.com/matrix-org/matrix-hookshot/issues/273))


1.3.0 (2022-03-30)
==================

Features
--------

- Generic webhooks now listen for incoming hooks on `/webhook`. Existing setups using `/` will continue to work, but should be migrated where possible. See [the documentation](https://matrix-org.github.io/matrix-hookshot/setup/webhooks.html#configuration) for more information. ([\#227](https://github.com/matrix-org/matrix-hookshot/issues/227))
- Logging now supports `json` format outputs and colourized logs. Startup logging should now be less noisy on non-debug levels. ([\#229](https://github.com/matrix-org/matrix-hookshot/issues/229))
- Use stable key `m.thread` for Figma threads. ([\#236](https://github.com/matrix-org/matrix-hookshot/issues/236))
- Add support for close events on GitLab merge requests. ([\#253](https://github.com/matrix-org/matrix-hookshot/issues/253))
- Hosted documentation now features a version selector. ([\#259](https://github.com/matrix-org/matrix-hookshot/issues/259))


Bugfixes
--------

- Fixed an issue which caused GitHub issue edit notifications to be posted to a room twice. ([\#230](https://github.com/matrix-org/matrix-hookshot/issues/230))
- Fix generic webhooks always returning an HTTP error when `waitForComplete` is enabled. ([\#247](https://github.com/matrix-org/matrix-hookshot/issues/247))
- Fix a bug that would cause Hookshot to crash when a Matrix message could not be sent ([\#249](https://github.com/matrix-org/matrix-hookshot/issues/249))
- Stop Figma threads showing as replies in clients. ([\#251](https://github.com/matrix-org/matrix-hookshot/issues/251))
- Fix an issue where the bridge bot would rejoin a room after being removed. ([\#257](https://github.com/matrix-org/matrix-hookshot/issues/257))
- Connections are now properly cleaned up when the state event is redacted. ([\#258](https://github.com/matrix-org/matrix-hookshot/issues/258))


Improved Documentation
----------------------

- Clarify homeserver requirements and configuration on the setup page. ([\#243](https://github.com/matrix-org/matrix-hookshot/issues/243))


Deprecations and Removals
-------------------------

- Drop support for Node.JS 12. Administrators are advised to upgrade to at least Node.JS 14. ([\#228](https://github.com/matrix-org/matrix-hookshot/issues/228))


Internal Changes
----------------

- Uppercase values for `logging.level` are now allowed, although lowercase values are preferred. ([\#250](https://github.com/matrix-org/matrix-hookshot/issues/250))


1.2.0 (2022-03-04)
==================

Features
--------

- Bot command help text now features category headers, and disabled commands are no longer visible. ([\#143](https://github.com/matrix-org/matrix-hookshot/issues/143))
- Automatically append the last comment on a closed GitHub issue notification, if the comment was made when the issue was closed. ([\#144](https://github.com/matrix-org/matrix-hookshot/issues/144))
- New configuraion option `permissions` to control who can use the bridge.
  **Please note**: By default, all users on the same homeserver will be given `admin` permissions (to reflect previous behaviour). Please adjust
  your config when updating. ([\#167](https://github.com/matrix-org/matrix-hookshot/issues/167))
- GitHub repo connections will notify when an issue has been labeled if `includingLabels` is configured. ([\#176](https://github.com/matrix-org/matrix-hookshot/issues/176))
- Jira Datacenter (On Premise) instances are now supported by Hookshot. See https://matrix-org.github.io/matrix-hookshot/setup/jira.html for more information. ([\#187](https://github.com/matrix-org/matrix-hookshot/issues/187))
- Use MSC3440 threads for figma comment threads. ([\#222](https://github.com/matrix-org/matrix-hookshot/issues/222))
- Add support for `v2` webhook transformation functions, supporting more options.
  See https://matrix-org.github.io/matrix-hookshot/setup/webhooks.html#javascript-transformations for more information ([\#223](https://github.com/matrix-org/matrix-hookshot/issues/223))
- Generic webhook payloads are now pretty printed. ([\#224](https://github.com/matrix-org/matrix-hookshot/issues/224))


Bugfixes
--------

- Fix a bug which caused GitHub "ready for review" events to be unhandled. ([\#149](https://github.com/matrix-org/matrix-hookshot/issues/149))
- Fix a bug preventing `!hookshot jira project` from working ([\#166](https://github.com/matrix-org/matrix-hookshot/issues/166))
- Fix a few issues preventing GitHub notifications from working ([\#173](https://github.com/matrix-org/matrix-hookshot/issues/173))
- Fixed an issue where the bridge bot would change its displayname if a webhook event is handled while `generic.userIdPrefix` is not set in the config. ([\#215](https://github.com/matrix-org/matrix-hookshot/issues/215))
- Remove nonfunctional `gitlab notifications toggle` command. ([\#226](https://github.com/matrix-org/matrix-hookshot/issues/226))


Improved Documentation
----------------------

- Update registration.sample.yml to include the required localparts for all supported services ([\#162](https://github.com/matrix-org/matrix-hookshot/issues/162))


Internal Changes
----------------

- Refactor setup commands code to use the same checks as the provisioning code. ([\#141](https://github.com/matrix-org/matrix-hookshot/issues/141))
- Add icons to documentation for supported platforms. ([\#168](https://github.com/matrix-org/matrix-hookshot/issues/168))
- Do not hardcode `--target x86_64-unknown-linux-gnu` when installing Rust (rely on platform auto-detection instead) ([\#184](https://github.com/matrix-org/matrix-hookshot/issues/184))
- The GitHub repository has moved from `https://github.com/Half-Shot/matrix-hookshot` to `https://github.com/matrix-org/matrix-hookshot`. ([\#216](https://github.com/matrix-org/matrix-hookshot/issues/216))


1.1.0 (2022-01-07)
==================

Features
--------

- Add support for [Figma](https://www.figma.com) webhooks. ([\#103](https://github.com/half-shot/matrix-hookshot/issues/103))
- Support GitLab wiki page change events for GitLabProject connections. ([\#104](https://github.com/half-shot/matrix-hookshot/issues/104))
- Add new script `validate-config` which check your config file for simple errors. ([\#125](https://github.com/half-shot/matrix-hookshot/issues/125))
- Add support for a `html` key on generic webhooks to set the HTML content of a Matrix message. ([\#130](https://github.com/half-shot/matrix-hookshot/issues/130))


Bugfixes
--------

- Fix an issue introduced in #111 that would cause the build to fail in CI. ([\#111](https://github.com/half-shot/matrix-hookshot/issues/111))
- Fix a bug where the bridge would not start if only generic webhooks are configured. ([\#113](https://github.com/half-shot/matrix-hookshot/issues/113))


Improved Documentation
----------------------

- Fix a couple of typos in `docs/setup.md`. Thanks @HarHarLinks! ([\#107](https://github.com/half-shot/matrix-hookshot/issues/107))
- Improve documentation sidepanel with emojis! ([\#110](https://github.com/half-shot/matrix-hookshot/issues/110))
- Fix incorrect command for webhook setup ([\#115](https://github.com/half-shot/matrix-hookshot/issues/115))
- Improve docs around listener and generic webhook configuration ([\#124](https://github.com/half-shot/matrix-hookshot/issues/124))
- Improve documentation for OAuth listener setup ([\#132](https://github.com/half-shot/matrix-hookshot/issues/132))


Internal Changes
----------------

- Update to npai-rs@2 ([\#111](https://github.com/half-shot/matrix-hookshot/issues/111))
- Port GitHub formatting functions to Rust. ([\#126](https://github.com/half-shot/matrix-hookshot/issues/126))


1.0.0 (2021-12-21)
===================

This release is huge, containing not only a rename but many new features and bug fixes. To name some of the highlights:

- The bridge has now been renamed from `matrix-github` to `matrix-hookshot`.
- Now supports JIRA and Generic Webhooks in addition to GitHub and GitLab.
- Includes new commands and metrics reporting.
- Includes complete documentation.

As always, please contact me (@Half-Shot:half-shot.uk) if you require any help getting this setup and please report any bugs you encounter!

Features
--------

- The bridge now supports generic webhook bridging. ([\#77](https://github.com/half-shot/matrix-hookshot/issues/77))
- Add support for JIRA. ([\#82](https://github.com/half-shot/matrix-hookshot/issues/82))
- Add Provisioning API. Extra thanks to @turt2live for supporting this change. ([\#83](https://github.com/half-shot/matrix-hookshot/issues/83))
- GitHub support no longer needs an installation ID defined.
  Licence in package.json now accurately reflects `LICENCE`
  GitHub workflows can now be run with `!gh workflow run` on GitHubRepo connections. ([\#85](https://github.com/half-shot/matrix-hookshot/issues/85))
- Add `!hookshot` setup command for quickly setting up new rooms with the bridge. ([\#88](https://github.com/half-shot/matrix-hookshot/issues/88))
- Issues created with !gh create show the issue number inside a reaction.
  GitHubRepo connections can now optionally show a small diff for PRs.
  PRs can be reviewed by replying with a ✅ or a ❌ and a small text message. ([\#93](https://github.com/half-shot/matrix-hookshot/issues/93))
- Add support for `includingLabels`/`excludingLabels` state config for GitHubRepo and GitLab Repo connections, allowing rooms to recieve a subset of issue and PR/MR notifications based on labels. ([\#95](https://github.com/half-shot/matrix-hookshot/issues/95))
- Add automatic changelog generation via [Towncrier](https://github.com/twisted/towncrier). ([\#96](https://github.com/half-shot/matrix-hookshot/issues/96))
- Add support for exporting [Prometheus](https://prometheus.io) metrics. ([\#99](https://github.com/half-shot/matrix-hookshot/issues/99))
- Switch to using the `vm2` module for improved sandboxing of transformation functions ([\#101](https://github.com/half-shot/matrix-hookshot/issues/101))
- Allow running multiple resources on the same HTTP listener. See the new `listeners` config.([\#102](https://github.com/half-shot/matrix-hookshot/issues/102))



Improved Documentation
----------------------

- Add documentation for most functionality in the bridge. ([\#90](https://github.com/half-shot/matrix-hookshot/issues/90))


Internal Changes
----------------

- The bridge now depends on Rust modules for some functionality. ([\#78](https://github.com/half-shot/matrix-hookshot/issues/78))
- The project has been renamed `matrix-hookshot`. ([\#81](https://github.com/half-shot/matrix-hookshot/issues/81))
- Use quotes instead of brackets in GH PRs. Thanks @Twi1ightSparkle! ([\#92](https://github.com/half-shot/matrix-hookshot/issues/92))
- Fix spelling of received. Thanks @andybalaam! ([\#94](https://github.com/half-shot/matrix-hookshot/issues/94))
- CI jobs now report the diff between the generated config and the in-tree sample config. ([\#97](https://github.com/half-shot/matrix-hookshot/issues/97))

0.1.0 (2021-04-21)
==================
This is the initial release of the GitHub bridge.
