5.4.1 (2024-06-21)
==================

Internal Changes
----------------

- Pin the minor version of Node for Docker builds to avoid a startup crash on arm64. ([\#949](https://github.com/matrix-org/matrix-hookshot/issues/949))


5.4.0 (2024-06-20)
==================

Features
--------

- Add support for reopened GitLab MR. ([\#935](https://github.com/matrix-org/matrix-hookshot/issues/935))
- Add support for new connection type "Outgoing Webhooks". This feature allows you to send outgoing HTTP requests to other services
  when a message appears in a Matrix room. See [the documentation](https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html)
  for help with this feature. ([\#945](https://github.com/matrix-org/matrix-hookshot/issues/945))


Bugfixes
--------

- Fix GitLab's ready for review hook. ([\#936](https://github.com/matrix-org/matrix-hookshot/issues/936))
- Fix rendering of comments of GitLab merge requests. ([\#937](https://github.com/matrix-org/matrix-hookshot/issues/937))
- Fix the symbol used to prefix GitLab merge requests. ([\#938](https://github.com/matrix-org/matrix-hookshot/issues/938))


5.3.0 (2024-04-17)
==================

Features
--------

- Add support for Challenge Hound. ([\#924](https://github.com/matrix-org/matrix-hookshot/issues/924))


Bugfixes
--------

- Ensure generic webhooks have appropriate Content-Security-Policy headers. ([\#926](https://github.com/matrix-org/matrix-hookshot/issues/926))
- Fix a few bugs introduced in challenge hound support. ([\#927](https://github.com/matrix-org/matrix-hookshot/issues/927))
- Track which key was used to encrypt secrets in storage, and encrypt/decrypt secrets in Rust. ([\#929](https://github.com/matrix-org/matrix-hookshot/issues/929), [\#930](https://github.com/matrix-org/matrix-hookshot/issues/930)) 


Improved Documentation
----------------------

- Fixes the OpenID Connect call back URI in the config defaults and docs. ([\#899](https://github.com/matrix-org/matrix-hookshot/issues/899))
- Clarify permissions system documentation. ([\#925](https://github.com/matrix-org/matrix-hookshot/issues/925))


Deprecations and Removals
-------------------------

- The cache/queue configuration has been changed in this release. The `queue.monolithic` option has been deprecated, in place of a dedicated `cache`
  config section. Check the ["Cache configuration" section](https://matrix-org.github.io/matrix-hookshot/latest/setup.html#cache-configuration) for
  more information on how to configure Hookshot caches. ([\#902](https://github.com/matrix-org/matrix-hookshot/issues/902))


Internal Changes
----------------

- Switch expressjs to production mode for improved performance. ([\#904](https://github.com/matrix-org/matrix-hookshot/issues/904))
- Track which key was used to encrypt secrets in storage, and encrypt/decrypt secrets in Rust. ([\#915](https://github.com/matrix-org/matrix-hookshot/issues/915))


5.2.1 (2024-02-21)
==================

Bugfixes
--------

- Fix Atom feeds being repeated in rooms once after an upgrade. ([\#901](https://github.com/matrix-org/matrix-hookshot/issues/901))


5.2.0 (2024-02-21)
==================

Features
--------

- Add command to list feeds in JSON and YAML format to easily export all feeds from a room. ([\#876](https://github.com/matrix-org/matrix-hookshot/issues/876))
- Mention all assignees when a new issue is created on GitHub. ([\#889](https://github.com/matrix-org/matrix-hookshot/issues/889))
- Retry failed feed messages. ([\#891](https://github.com/matrix-org/matrix-hookshot/issues/891))


Bugfixes
--------

- Fix widgets failing with "Request timed out". ([\#870](https://github.com/matrix-org/matrix-hookshot/issues/870))


Improved Documentation
----------------------

- Mention new and legacy webhook paths in setup documentation. ([\#879](https://github.com/matrix-org/matrix-hookshot/issues/879))
- Add troubleshooting page to documentation, to cover common issues. ([\#882](https://github.com/matrix-org/matrix-hookshot/issues/882))


Internal Changes
----------------

- Failing RSS/atom feeds are now backed off before being retried. This should result in a speedup for large public deployments where failing feeds may result in a slowdown. ([\#890](https://github.com/matrix-org/matrix-hookshot/issues/890))


5.1.2 (2024-01-02)
==================

Bugfixes
--------

- Fix widget pinning to light theme. ([\#873](https://github.com/matrix-org/matrix-hookshot/issues/873))
- Fix hookshot failing to format API errors.
  Only log a stacktrace of API errors on debug level logging, log limited error on info. ([\#874](https://github.com/matrix-org/matrix-hookshot/issues/874))
- Fix GitHub events not working due to verification failures. ([\#875](https://github.com/matrix-org/matrix-hookshot/issues/875))


Internal Changes
----------------

- Fix spelling of "successfully". ([\#869](https://github.com/matrix-org/matrix-hookshot/issues/869))


5.1.1 (2023-12-29)
==================

Bugfixes
--------

- Fix widgets not loading when bound to the same listener as "webhooks". ([\#872](https://github.com/matrix-org/matrix-hookshot/issues/872))


5.1.0 (2023-12-29)
==================

Bugfixes
--------

- Fix feed widget not showing the true values for template / notify on failure. ([\#866](https://github.com/matrix-org/matrix-hookshot/issues/866))
- Fix widgets failing with "Request timed out". ([\#870](https://github.com/matrix-org/matrix-hookshot/issues/870))


Deprecations and Removals
-------------------------

- The GoNEB migrator is being removed in this release. Users wishing to migrate from GoNEB deployments should use <=5.0.0 and then upgrade. ([\#867](https://github.com/matrix-org/matrix-hookshot/issues/867))


Internal Changes
----------------

- Integrate end to end testing. ([\#869](https://github.com/matrix-org/matrix-hookshot/issues/869))


5.0.0 (2023-12-27)
==================

Features
--------

- Warn if the bot does not have permissions to talk in a room. ([\#852](https://github.com/matrix-org/matrix-hookshot/issues/852))
- Support dark mode for the widget interface. ([\#863](https://github.com/matrix-org/matrix-hookshot/issues/863))
- Add `webhook list` and `webhook remove` commands. ([\#866](https://github.com/matrix-org/matrix-hookshot/issues/866))


Bugfixes
--------

- Fix notify on failure not being toggleable in the feeds widget interface. ([\#865](https://github.com/matrix-org/matrix-hookshot/issues/865))


Improved Documentation
----------------------

- Documentation tidyups. ([\#855](https://github.com/matrix-org/matrix-hookshot/issues/855), [\#857](https://github.com/matrix-org/matrix-hookshot/issues/857), [\#858](https://github.com/matrix-org/matrix-hookshot/issues/858), [\#859](https://github.com/matrix-org/matrix-hookshot/issues/859), [\#860](https://github.com/matrix-org/matrix-hookshot/issues/860))
- Generally tidy up and improve metrics documentation. ([\#856](https://github.com/matrix-org/matrix-hookshot/issues/856))


Deprecations and Removals
-------------------------

- Drop support for Node 18 and start supporting Node 21. ([\#862](https://github.com/matrix-org/matrix-hookshot/issues/862))


4.7.0 (2023-12-06)
==================

Internal Changes
----------------

- Update the release script to examine the staged contents of package files when checking for consistency between Node & Rust package versions. ([\#846](https://github.com/matrix-org/matrix-hookshot/issues/846))
- Use Node 20 (slim) for Docker image base. ([\#849](https://github.com/matrix-org/matrix-hookshot/issues/849))


4.6.0 (2023-11-20)
==================

Features
--------

- Add new `webhookResponse` field to the transformation API to specify your own response data. See the documentation for help. ([\#839](https://github.com/matrix-org/matrix-hookshot/issues/839))


Bugfixes
--------

- Fix version picker on docs site not loading. ([\#843](https://github.com/matrix-org/matrix-hookshot/issues/843))


Improved Documentation
----------------------

- Add note about GitHub token scope for private vs. public repo notifications ([\#830](https://github.com/matrix-org/matrix-hookshot/issues/830))


Internal Changes
----------------

- Update the release script to check for consistency between Node & Rust package versions. ([\#819](https://github.com/matrix-org/matrix-hookshot/issues/819))
- Chart version 0.1.14
  Do not populate optional values in default helm config, as default values are not valid. ([\#821](https://github.com/matrix-org/matrix-hookshot/issues/821))
- Release chart version 0.1.15.
  Sample config now comments out optional parameters by default. ([\#826](https://github.com/matrix-org/matrix-hookshot/issues/826))


4.5.1 (2023-09-26)
==================

Bugfixes
--------

- Fix transformation scripts breaking if they include a `return` at the top level ([\#818](https://github.com/matrix-org/matrix-hookshot/issues/818))


4.5.0 (2023-09-26)
==================

Features
--------

- Bridge Gitlab comment replies as Matrix threads. ([\#758](https://github.com/matrix-org/matrix-hookshot/issues/758))
- Add generic webhook transformation JS snippet for Prometheus Alertmanager. ([\#808](https://github.com/matrix-org/matrix-hookshot/issues/808))


Bugfixes
--------

- Fix a potential memory leak where Hookshot may hold onto certain requests forever in memory. ([\#814](https://github.com/matrix-org/matrix-hookshot/issues/814))
- Fix feed metrics treating request failures as parsing failures. ([\#816](https://github.com/matrix-org/matrix-hookshot/issues/816))


Deprecations and Removals
-------------------------

- Drop support for the Sled crypto store format. Users must disable/remove the configuration key of `experimentalEncryption.useLegacySledStore`, and the crypto store will always use the SQLite format. If an existing SQLite store does not exist on bridge startup, one will be created. ([\#798](https://github.com/matrix-org/matrix-hookshot/issues/798))


Internal Changes
----------------

- Update the version number of Hookshot's Rust package. ([\#803](https://github.com/matrix-org/matrix-hookshot/issues/803))
- Update eslint to a version that supports Typescript 5.1.3. ([\#815](https://github.com/matrix-org/matrix-hookshot/issues/815))
- Use quickjs instead of vm2 for evaluating JS transformation functions. ([\#817](https://github.com/matrix-org/matrix-hookshot/issues/817))


4.4.1 (2023-07-31)
==================

It is **strongly** reccomended you upgrade your bridge, as this release contains security fixes.

🔒 Security
-----------

- Fixes for GHSA-vc7j-h8xg-fv5x.


Features
--------

- Add more icons to GitHub repo hooks ([\#795](https://github.com/matrix-org/matrix-hookshot/issues/795))


Bugfixes
--------

- Fix instructions for validating your config using Docker ([\#787](https://github.com/matrix-org/matrix-hookshot/issues/787))


Internal Changes
----------------

- Sort feed list alphabetically in bot command response ([\#791](https://github.com/matrix-org/matrix-hookshot/issues/791))
- Update word-wrap from 1.2.3 to 1.2.4. ([\#799](https://github.com/matrix-org/matrix-hookshot/issues/799))
- Update matrix-appservice-bridge to 9.0.1. ([\#800](https://github.com/matrix-org/matrix-hookshot/issues/800))


4.4.0 (2023-06-28)
==================

Bugfixes
--------

- Refactor Hookshot to use Redis for caching of feed information, massively improving memory usage.

  Please note that this is a behavioural change: Hookshots configured to use in-memory caching (not Redis),
  will no longer bridge any RSS entries it may have missed during downtime, and will instead perform an initial
  sync (not reporting any entries) instead. ([\#786](https://github.com/matrix-org/matrix-hookshot/issues/786))

- Feeds now tries to find an HTML-type link before falling back to the first link when parsing atom feeds ([\#784](https://github.com/matrix-org/matrix-hookshot/issues/784))


4.3.0 (2023-06-19)
==================

Features
--------

- Added basic helm chart to repository with GitHub Actions / chart-releaser builds ([\#719](https://github.com/matrix-org/matrix-hookshot/issues/719))
- Feeds are now polled concurrently (defaulting to 4 feeds at a time). ([\#779](https://github.com/matrix-org/matrix-hookshot/issues/779))


4.2.0 (2023-06-05)
===================

Features
--------

- Add support for uploading bot avatar images. ([\#767](https://github.com/matrix-org/matrix-hookshot/issues/767))


Bugfixes
--------

- Fix confusing case where issue comments would be notified on if the issue event type is checked on GitHub connections. ([\#757](https://github.com/matrix-org/matrix-hookshot/issues/757))
- Fix crash when failing to handle events, typically due to lacking permissions to send messages in a room. ([\#771](https://github.com/matrix-org/matrix-hookshot/issues/771))


4.1.0 (2023-05-24)
==================

Features
--------

- Add support for notifying when a GitLab MR has a single review (rather than completed review). ([\#736](https://github.com/matrix-org/matrix-hookshot/issues/736))
- Add support for Sentry tracing. ([\#754](https://github.com/matrix-org/matrix-hookshot/issues/754))


Bugfixes
--------

- Fix feed message format when the item does not contain a title or link. ([\#737](https://github.com/matrix-org/matrix-hookshot/issues/737))
- Fix HTML appearing in its escaped form in feed item summaries. ([\#738](https://github.com/matrix-org/matrix-hookshot/issues/738))
- Fix Github comments not being rendered correctly as blockquotes. ([\#746](https://github.com/matrix-org/matrix-hookshot/issues/746))
- Fix setup issues when the bot has PL 0 and room default isn't 0. ([\#755](https://github.com/matrix-org/matrix-hookshot/issues/755))


Internal Changes
----------------

- Apply non-style suggestions by `cargo clippy` to reduce allocations in the rust code. ([\#750](https://github.com/matrix-org/matrix-hookshot/issues/750))
- Apply more Rust clippy suggestions, and run clippy in CI. ([\#753](https://github.com/matrix-org/matrix-hookshot/issues/753))
- Update eslint to a version that supports Typescript 5. ([\#760](https://github.com/matrix-org/matrix-hookshot/issues/760))


4.0.0 (2023-04-27)
==================

Features
--------

- Add support for specifying custom templates for feeds. ([\#702](https://github.com/matrix-org/matrix-hookshot/issues/702))
- Use SQLite for file-based crypto stores by default, instead of Sled. ([\#714](https://github.com/matrix-org/matrix-hookshot/issues/714))
- Notifications for RSS feed failures can now be toggled on and off. The feature is now **off** by default. ([\#716](https://github.com/matrix-org/matrix-hookshot/issues/716))


Bugfixes
--------

- Fix mishandling of empty feed/item title tags. ([\#708](https://github.com/matrix-org/matrix-hookshot/issues/708))
- Add information about GitHub App Installs in 'update' state on the oauth status page. ([\#717](https://github.com/matrix-org/matrix-hookshot/issues/717))
- Fix cases of GitHub repos not being bridgable if the GitHub App had to be manually approved. ([\#718](https://github.com/matrix-org/matrix-hookshot/issues/718))
- Switch to using Rust for parsing RSS feeds. ([\#721](https://github.com/matrix-org/matrix-hookshot/issues/721))


Deprecations and Removals
-------------------------

- Add support for Node 20, and drop support for Node 16. ([\#724](https://github.com/matrix-org/matrix-hookshot/issues/724))


Internal Changes
----------------

- Ensure all Hookshot specific metrics have a `hookshot_` prefix. ([\#701](https://github.com/matrix-org/matrix-hookshot/issues/701))
- Update dependency used in Generic Webhook JS functions to fix a security flaw. ([\#705](https://github.com/matrix-org/matrix-hookshot/issues/705))
- Switch to using Rust for parsing RSS feeds. ([\#709](https://github.com/matrix-org/matrix-hookshot/issues/709))
- Update the README with a prettier set of features. ([\#726](https://github.com/matrix-org/matrix-hookshot/issues/726))
- Update `yaml` dependency to `2.2.2` ([\#728](https://github.com/matrix-org/matrix-hookshot/issues/728))


3.2.0 (2023-04-04)
==================

Features
--------

- Allow users to import other people's go-neb services. ([\#695](https://github.com/matrix-org/matrix-hookshot/issues/695))
- Add support for push events on Github repo connections. ([\#696](https://github.com/matrix-org/matrix-hookshot/issues/696))
- Add support for issue created notifications in Github Repo connections. ([\#697](https://github.com/matrix-org/matrix-hookshot/issues/697))
- Support using the `guid` field of an RSS feed entry as a link ([\#700](https://github.com/matrix-org/matrix-hookshot/issues/700))


Internal Changes
----------------

- Only run changelog checks when only the changelog changes in CI. ([\#692](https://github.com/matrix-org/matrix-hookshot/issues/692))


3.1.1 (2023-03-28)
==================

Bugfixes
--------

- Fix the bridge spamming RSS feeds repeatedly. ([\#694](https://github.com/matrix-org/matrix-hookshot/issues/694))


Internal Changes
----------------

- Fix release script setting the tag message to "-". ([\#693](https://github.com/matrix-org/matrix-hookshot/issues/693))


3.1.0 (2023-03-28)
==================

Bugfixes
--------

- Ensure Hookshot shuts down faster when running feeds. ([\#671](https://github.com/matrix-org/matrix-hookshot/issues/671))
- Fix GitHub repo connections not always applying state updates. ([\#672](https://github.com/matrix-org/matrix-hookshot/issues/672))
- Don't hide Create Connection button in Migration component. ([\#675](https://github.com/matrix-org/matrix-hookshot/issues/675))
- Ensure the widget still works without needing to store local storage data. ([\#678](https://github.com/matrix-org/matrix-hookshot/issues/678))
- Fix a missing grant for a connection sometimes causing a crash. ([\#680](https://github.com/matrix-org/matrix-hookshot/issues/680))
- Don't check Content-Type of RSS feeds when adding a new connection, instead just check if the feed is valid. ([\#684](https://github.com/matrix-org/matrix-hookshot/issues/684))
- Make sure we're not treating garbage data in feed items as guids. ([\#687](https://github.com/matrix-org/matrix-hookshot/issues/687))
- Improve resiliency to invite/join races when Hookshot is added by an integration manager. ([\#691](https://github.com/matrix-org/matrix-hookshot/issues/691))


Internal Changes
----------------

- Add release.sh script and release.yml workflow to make the release process easier. ([\#667](https://github.com/matrix-org/matrix-hookshot/issues/667))
- Add a /ready and /live endpoint to each listener, so that it can be checked independently. ([\#676](https://github.com/matrix-org/matrix-hookshot/issues/676))
- Add `feed_failing` metric to track the number of feeds failing to be read or parsed. ([\#681](https://github.com/matrix-org/matrix-hookshot/issues/681))
- Stagger RSS feed polling over the interval period, rather than attempting to poll all feeds at once. Should reduce memory / CPU spikes. ([\#685](https://github.com/matrix-org/matrix-hookshot/issues/685))


3.0.1 (2023-03-21)
===================

Bugfixes
--------

- Fix GitHub OAuth button causing a "Could not find user which authorised this request" error . ([\#663](https://github.com/matrix-org/matrix-hookshot/issues/663))
- Fix GitHub grant checker applying a different grant ID than the one it checks for. ([\#665](https://github.com/matrix-org/matrix-hookshot/issues/665))


Internal Changes
----------------

- Small grammar fix. ([\#664](https://github.com/matrix-org/matrix-hookshot/issues/664))
- Show a sensible error when a GitHub installation is pending. ([\#666](https://github.com/matrix-org/matrix-hookshot/issues/666))


3.0.0 (2023-03-17)
==================

This release includes some new landmark improvements to support **public Hookshots**.

One key feature is the new Go-NEB migrator. If you run a Go-NEB instance currently and are looking for a way to migrate GitHub and RSS feeds
over to Hookshot, there is a nice fancy widget feature for this.

The other feature is we have now implemented a "Grant" system for authorising new connections in rooms. Simply put when you create a new connection
in a room to a remote service like GitHub, we now store the validity of that authorisation in the bridge. This is a new change where previously we
would not persist this authorization between sessions, so it was possible for users (who were permitted in the config to `manageConnections`) to create
connections to anywhere Hookshot was already configured to talk to. This piece of extra security means we can now be more confident about allowing Hookshot
to be used in public spaces.

Upgrading to 3.0.0 **is breaking**, as the new grant system will run against any of your previous connections. It is imperative that where you have
created or edited a connection manually in the room state, that you are still authenticated to the service it is connected to. For instance, ensure
you are logged into GitHub if you have created manual GitHub connections. You can check the logs for any information on which connections have not
been granted. 

For any users who are not able to immediately update, but are nontheless worried about the consequeneces for this change: Do not panic. You can always
update the permissions in your config to only allow `manageConnections` to users you trust.

If you have any questions about this change, do not hesistate to reach out to `#hookshot:half-shot.uk`.

Features
--------

- Add support from migrating go-neb services to Hookshot ([\#647](https://github.com/matrix-org/matrix-hookshot/issues/647))
- Implement grant system to internally record all approved connections in hookshot. ([\#655](https://github.com/matrix-org/matrix-hookshot/issues/655))


Bugfixes
--------

- `roomSetupWidget` in widget config does now allow an empty value ([\#657](https://github.com/matrix-org/matrix-hookshot/issues/657))
- Fix service bots not being able to reject invites with a reason. ([\#659](https://github.com/matrix-org/matrix-hookshot/issues/659))
- Fix Hookshot presenting room connections as editable if the user has a default-or-greater power levels. This was only a presentation bug, power levels were and are proeprly checked at creation/edit time. ([\#660](https://github.com/matrix-org/matrix-hookshot/issues/660))
- Add support for logging into GitHub via OAuth from bridge widgets. ([\#661](https://github.com/matrix-org/matrix-hookshot/issues/661))


Improved Documentation
----------------------

- Update docs and sample config for serviceBots. Thanks to @HarHarLinks. ([\#643](https://github.com/matrix-org/matrix-hookshot/issues/643))


Internal Changes
----------------

- Replace `uuid` package with `crypto.randomUUID` function. ([\#640](https://github.com/matrix-org/matrix-hookshot/issues/640))
- Minor improvements to widget UI styles. ([\#652](https://github.com/matrix-org/matrix-hookshot/issues/652))
- Run docker-latest CI for incoming pull requests. ([\#662](https://github.com/matrix-org/matrix-hookshot/issues/662))


2.7.0 (2023-01-20)
==================

Features
--------

- The room configuration widget now features an improved project search component, which now shows project avatars and descriptions. ([\#624](https://github.com/matrix-org/matrix-hookshot/issues/624))


2.6.1 (2023-01-16)
==================

Features
--------

- The message in the admin room when creating a webhook now also shows the name and links to the room. ([\#620](https://github.com/matrix-org/matrix-hookshot/issues/620))


Bugfixes
--------

- Fixed generic webhook 'user is already in the room' error ([\#627](https://github.com/matrix-org/matrix-hookshot/issues/627))
- Hookshot now handles `uk.half-shot.matrix-hookshot.generic.hook` state event updates ([\#628](https://github.com/matrix-org/matrix-hookshot/issues/628))


2.6.0 (2023-01-13)
==================

Features
--------

- Add support for end-to-bridge encryption via MSC3202. ([\#299](https://github.com/matrix-org/matrix-hookshot/issues/299))
- Add support for additional bot users called "service bots" which handle a particular connection type, so that different services can be used through different bot users. ([\#573](https://github.com/matrix-org/matrix-hookshot/issues/573))
- Add new GitHubRepo connection config setting `workflowRun.workflows` to filter run reports by workflow name. ([\#588](https://github.com/matrix-org/matrix-hookshot/issues/588))
- The GitHub/GitLab connection state configuration has changed. The configuration option `ignoreHooks` is now deprecated, and new connections may not use this options.
  Users should instead explicitly configure all the hooks they want to enable with the `enableHooks` option. Existing connections will continue to work with both options. ([\#592](https://github.com/matrix-org/matrix-hookshot/issues/592))
- A11y: Add alt tags to all images. ([\#602](https://github.com/matrix-org/matrix-hookshot/issues/602))


Bugfixes
--------

- Parent projects are now taken into account when calculating a user's access level to a GitLab project. ([\#539](https://github.com/matrix-org/matrix-hookshot/issues/539))
- Ensure bridge treats published and drafted GitHub releases as different events. ([\#582](https://github.com/matrix-org/matrix-hookshot/issues/582))
- Fix a bug where unknown keys in a connections state would be clobbered when updated via widget UI. ([\#587](https://github.com/matrix-org/matrix-hookshot/issues/587))
- Improve webhook code editor performance. ([\#601](https://github.com/matrix-org/matrix-hookshot/issues/601))
- Correctly apply CSS for recent RSS feed changes. ([\#604](https://github.com/matrix-org/matrix-hookshot/issues/604))
- Improve startup stability by not loading all room state at once. ([\#614](https://github.com/matrix-org/matrix-hookshot/issues/614))
- You can now add multiple GitLab connections to the same room with the same project path, if they are under different instances. ([\#617](https://github.com/matrix-org/matrix-hookshot/issues/617))


Improved Documentation
----------------------

- Clarify GitLab setup docs ([\#350](https://github.com/matrix-org/matrix-hookshot/issues/350))
- Change URL protocol in the ocumentation and sample configs to HTTPS. ([\#623](https://github.com/matrix-org/matrix-hookshot/issues/623))


Deprecations and Removals
-------------------------

- Remove support for Pantalaimon-based encryption. ([\#299](https://github.com/matrix-org/matrix-hookshot/issues/299))


Internal Changes
----------------

- RSS feed polling now uses cache headers sent by servers, which should mean we will be more conservative on resources. ([\#583](https://github.com/matrix-org/matrix-hookshot/issues/583))
- Only build ARM images when merging or releasing, due to slow ARM build times. ([\#589](https://github.com/matrix-org/matrix-hookshot/issues/589))
- Increase maximum size of incoming webhook payload from `100kb` to `10mb`. ([\#606](https://github.com/matrix-org/matrix-hookshot/issues/606))
- Mark encryption feature as experimental (config option is now `experimentalEncryption`). ([\#610](https://github.com/matrix-org/matrix-hookshot/issues/610))
- Cache yarn dependencies during Docker build. ([\#615](https://github.com/matrix-org/matrix-hookshot/issues/615))


2.5.0 (2022-12-02)
==================

Features
--------

- GitHub assign command now automatically chooses the top issue and/or authenticated user if not provided. ([\#554](https://github.com/matrix-org/matrix-hookshot/issues/554))
- Display GitLab project paths with their true letter casing. ([\#556](https://github.com/matrix-org/matrix-hookshot/issues/556))
- Forbid creating multiple GitLab connections on the same path with different letter casing. ([\#557](https://github.com/matrix-org/matrix-hookshot/issues/557))
- Allow adding connections to GitLab projects even when Hookshot doesn't have permissions to automatically provision a webhook for it. When that occurs, tell the user to ask a project admin to add the webhook. ([\#567](https://github.com/matrix-org/matrix-hookshot/issues/567))


Bugfixes
--------

- Do not send a notice when a user replies to a GitLab comment, or when GitLab comment notices have been disabled. ([\#536](https://github.com/matrix-org/matrix-hookshot/issues/536))
- Don't announce error if a RSS feed request timed out. ([\#551](https://github.com/matrix-org/matrix-hookshot/issues/551))
- Don't ignore events from GitLab projects that have capital letters in their project path, and had their room connection set up by the configuration widget or provisioning API. ([\#553](https://github.com/matrix-org/matrix-hookshot/issues/553))
- Automatically JSON stringify values in a webhook payload that exceed the max depth/breadth supported by the parser. ([\#560](https://github.com/matrix-org/matrix-hookshot/issues/560))
- The bot no longer accepts invites from users who do not have permission to use it. ([\#561](https://github.com/matrix-org/matrix-hookshot/issues/561))
- Fix issue where GitLab connections couldn't be added via a bot command for projects on an instance URL configured with a trailing slash. ([\#563](https://github.com/matrix-org/matrix-hookshot/issues/563))
- Harden against unauthorized changes to room state for connection settings. ([\#565](https://github.com/matrix-org/matrix-hookshot/issues/565))
- Fixed a case where a bridge-created admin room would stop working on restart. ([\#578](https://github.com/matrix-org/matrix-hookshot/issues/578))


Improved Documentation
----------------------

- Improve navigability & legibility of some documentation pages. ([\#568](https://github.com/matrix-org/matrix-hookshot/issues/568))


Internal Changes
----------------

- Increase default `feeds.pollTimeoutSeconds` from 10 seconds to 30. ([\#483](https://github.com/matrix-org/matrix-hookshot/issues/483))
- Don't provision a connection twice when using a bot command to create a connection. ([\#558](https://github.com/matrix-org/matrix-hookshot/issues/558))
- Change "setup" to "set up" where it's used as a verb. ([\#572](https://github.com/matrix-org/matrix-hookshot/issues/572))
- Fix misspellings of "occurred" in error messages. ([\#576](https://github.com/matrix-org/matrix-hookshot/issues/576))


2.4.0 (2022-10-21)
==================

Features
--------

- Add support for notifying when a GitHub workflow completes. ([\#520](https://github.com/matrix-org/matrix-hookshot/issues/520))
- Disable GitHub workflow events by default. ([\#528](https://github.com/matrix-org/matrix-hookshot/issues/528))
- Support Jira version events. ([\#534](https://github.com/matrix-org/matrix-hookshot/issues/534))
- Allow multiple Jira connections at a time (either in the same room or across multiple rooms). ([\#540](https://github.com/matrix-org/matrix-hookshot/issues/540))


Bugfixes
--------

- Mention the `help` in AdminRooms if they send an invalid command. ([\#522](https://github.com/matrix-org/matrix-hookshot/issues/522))
- Fix an issue where `github status` would not respond with an error if your personal token had expired.
  Fix GitHub refresh tokens occasionally not working. ([\#523](https://github.com/matrix-org/matrix-hookshot/issues/523))
- Add support for notifying when a GitHub workflow completes. ([\#524](https://github.com/matrix-org/matrix-hookshot/issues/524))
- Fix a crash caused by invalid configuration in connection state events. ([\#537](https://github.com/matrix-org/matrix-hookshot/issues/537))
- Fix the Jira config widget to properly add listeners for issue creation events & expose support for issue update events. ([\#543](https://github.com/matrix-org/matrix-hookshot/issues/543))


Internal Changes
----------------

- Use the `matrix-appservice-bridge` logging implementation. ([\#488](https://github.com/matrix-org/matrix-hookshot/issues/488))
- Increase network timeout for Docker builds, and fix Docker build OOMing in CI for arm64 builds. ([\#535](https://github.com/matrix-org/matrix-hookshot/issues/535))


2.3.0 (2022-10-05)
==================

Features
--------

- Added `create-confidential` GitLab connection command. ([\#496](https://github.com/matrix-org/matrix-hookshot/issues/496))
- Add new GitLab connection flag `includeCommentBody`, to enable including the body of comments on MR notifications. ([\#500](https://github.com/matrix-org/matrix-hookshot/issues/500), [\#517](https://github.com/matrix-org/matrix-hookshot/issues/517))
- Add room configuration widget for Jira. ([\#502](https://github.com/matrix-org/matrix-hookshot/issues/502))
- Add bot commands to list and remove Jira connections. ([\#503](https://github.com/matrix-org/matrix-hookshot/issues/503))
- Reorganize the GitHub widget to allow searching for repositories by organization. ([\#508](https://github.com/matrix-org/matrix-hookshot/issues/508))
- Print a notice message after successfully logging in to GitHub when conversing with the bot in a DM. ([\#512](https://github.com/matrix-org/matrix-hookshot/issues/512))


Bugfixes
--------

- Give a warning if the user attempts to add a configuration widget to the room without giving the bot permissions. ([\#491](https://github.com/matrix-org/matrix-hookshot/issues/491))
- Improve formatting of help commands and Jira's `whoami` command. ([\#504](https://github.com/matrix-org/matrix-hookshot/issues/504))
- Add a configuration widget for Jira. ([\#507](https://github.com/matrix-org/matrix-hookshot/issues/507))
- Fix inactive "Command Prefix" field in configuration widgets. ([\#515](https://github.com/matrix-org/matrix-hookshot/issues/515))
- Fix support for the "Labeled" event in the GitHub widget. ([\#519](https://github.com/matrix-org/matrix-hookshot/issues/519))


Internal Changes
----------------

- Improve some type-checking in the codebase. ([\#505](https://github.com/matrix-org/matrix-hookshot/issues/505))
- Refactor the Vite component's `tsconfig.json` file to make it compatible with the TypeScript project settings & the TypeScript language server. ([\#506](https://github.com/matrix-org/matrix-hookshot/issues/506))
- Don't send empty query string in some widget API requests. ([\#518](https://github.com/matrix-org/matrix-hookshot/issues/518))


2.2.0 (2022-09-16)
==================

Features
--------

- Ready/draft state changes for GitLab merge requests are now reported. ([\#480](https://github.com/matrix-org/matrix-hookshot/issues/480))
- Merge GitLab MR approvals and comments into one message. ([\#484](https://github.com/matrix-org/matrix-hookshot/issues/484))


Bugfixes
--------

- Log noisy "Got GitHub webhook event" log line at debug level. ([\#473](https://github.com/matrix-org/matrix-hookshot/issues/473))
- Fix Figma service not being able to create new webhooks on startup, causing a crash. ([\#481](https://github.com/matrix-org/matrix-hookshot/issues/481))
- Fix a bug where the bridge can crash when JSON logging is enabled. ([\#478](https://github.com/matrix-org/matrix-hookshot/issues/478))


Internal Changes
----------------

- Update codemirror and remove unused font. ([\#489](https://github.com/matrix-org/matrix-hookshot/issues/489))


2.1.2 (2022-09-03)
==================

Bugfixes
--------

- Fix a bug where reading RSS feeds could crash the process. ([\#469](https://github.com/matrix-org/matrix-hookshot/issues/469))


2.1.1 (2022-09-02)
==================

Bugfixes
--------

- Fixed issue where log lines would only be outputted when the `logging.level` is `debug`. ([\#467](https://github.com/matrix-org/matrix-hookshot/issues/467))


2.1.0 (2022-09-02)
==================

Features
--------

- Add support for ARM64 docker images. ([\#458](https://github.com/matrix-org/matrix-hookshot/issues/458))
- Added new config option `feeds.pollTimeoutSeconds` to explictly set how long to wait for a feed response. ([\#459](https://github.com/matrix-org/matrix-hookshot/issues/459))
- JSON logging output now includes new keys such as `error` and `args`. ([\#463](https://github.com/matrix-org/matrix-hookshot/issues/463))


Bugfixes
--------

- Fix error when responding to a provisioning request for a room that the Hookshot bot isn't yet a member of. ([\#457](https://github.com/matrix-org/matrix-hookshot/issues/457))
- Fix a bug users without "login" permissions could run login commands for GitHub/GitLab/JIRA, but get an error when attempting to store the token. Users now have their permissions checked earlier. ([\#461](https://github.com/matrix-org/matrix-hookshot/issues/461))
- Hookshot now waits for Redis to be ready before handling traffic. ([\#462](https://github.com/matrix-org/matrix-hookshot/issues/462))
- Fix room membership going stale for rooms used in the permissions config. ([\#464](https://github.com/matrix-org/matrix-hookshot/issues/464))


Improved Documentation
----------------------

- Be explicit that identifiers in the permissions yaml config need to be wrapped in quotes, because they start with the characters @ and !. ([\#453](https://github.com/matrix-org/matrix-hookshot/issues/453))


Internal Changes
----------------

- Track coverage of tests. ([\#351](https://github.com/matrix-org/matrix-hookshot/issues/351))


2.0.1 (2022-08-22)
==================

Bugfixes
--------

- Fix issue that would cause the bridge not to start when using Docker. ([\#448](https://github.com/matrix-org/matrix-hookshot/issues/448))


2.0.0 (2022-08-22)
==================

**Please note:** Minimum Node.JS version is now 16

Features
--------

- Add a configuration widget for GitHub. ([\#420](https://github.com/matrix-org/matrix-hookshot/issues/420))
- Add query parameter to scope room config widget to a particular service. ([\#441](https://github.com/matrix-org/matrix-hookshot/issues/441))


Bugfixes
--------

- Fix GitHub notices sometimes coming through multiple times if GitHub sends multiple copies of a webhook. ([\#429](https://github.com/matrix-org/matrix-hookshot/issues/429))
- Headers and paragraphs now rendered properly when outputted from a Generic webhook transformation function. ([\#443](https://github.com/matrix-org/matrix-hookshot/issues/443))
- Fixed issue where `!hookshot gitlab project` commands would fail with a "Failed to handle command." error. ([\#445](https://github.com/matrix-org/matrix-hookshot/issues/445))


Deprecations and Removals
-------------------------

- Minimum Node.JS version is now 16. Updated matrix-bot-sdk to 0.6.0. ([\#417](https://github.com/matrix-org/matrix-hookshot/issues/417))


Internal Changes
----------------

- Add Grafana dashboard including documentation. Contributed by @HarHarLinks ([\#407](https://github.com/matrix-org/matrix-hookshot/issues/407))
- Refactor the way room state is tracked for room-specific configuration, to increase code reuse. ([\#418](https://github.com/matrix-org/matrix-hookshot/issues/418))
- Add a new PR template body and a CODEOWNERS file. ([\#425](https://github.com/matrix-org/matrix-hookshot/issues/425))
- Add new CI workflow to check for signoffs. ([\#427](https://github.com/matrix-org/matrix-hookshot/issues/427))
- Correct the docstrings of some connection classes. ([\#428](https://github.com/matrix-org/matrix-hookshot/issues/428))
- Optimize docker image rebuilds. ([\#438](https://github.com/matrix-org/matrix-hookshot/issues/438))
- Better error logging when validating Figma webhooks on startup. ([\#440](https://github.com/matrix-org/matrix-hookshot/issues/440))


1.8.1 (2022-07-18)
==================

Features
--------

- Added support for decoding XML payloads when handling generic webhooks. ([\#410](https://github.com/matrix-org/matrix-hookshot/issues/410))


Bugfixes
--------

- If `widgets.addToAdminRooms` is set, add the admin widget to a DM room the bot is invited to, instead of the non-admin widget. ([\#411](https://github.com/matrix-org/matrix-hookshot/issues/411))
- Disallow empty and invalid values for the `widgets.publicUrl` and `generic.urlPrefix` configuration settings. ([\#412](https://github.com/matrix-org/matrix-hookshot/issues/412))
- Post a non-empty message in response to `github list-connections` when no connections are present. ([\#416](https://github.com/matrix-org/matrix-hookshot/issues/416))


Improved Documentation
----------------------

- Add deeplink for registration.sample.yml to setup documentation ([\#374](https://github.com/matrix-org/matrix-hookshot/issues/374))
- Update GitHub authentication documentation: list the steps for OAuth login (`github login`), and mention the correct command for checking GitHub authentication status (`github status`). ([\#415](https://github.com/matrix-org/matrix-hookshot/issues/415))


Internal Changes
----------------

- Add package scripts for cleaning build files (which can be run with `yarn clean`). ([\#414](https://github.com/matrix-org/matrix-hookshot/issues/414))


1.8.0 (2022-07-11)
==================

Bugfixes
--------

- GitHub OAuth URLs for Cloud now use the correct endpoint. ([\#377](https://github.com/matrix-org/matrix-hookshot/issues/377))
- Fixed setup webhook command not providing the right URL. ([\#379](https://github.com/matrix-org/matrix-hookshot/issues/379))
- Fixed generic webhook connections not updating when a previously configured transformation function is removed from state. ([\#383](https://github.com/matrix-org/matrix-hookshot/issues/383))
- Fix malformed webhook link in AdminRoom. ([\#384](https://github.com/matrix-org/matrix-hookshot/issues/384))
- GitHub admin room notifications will now continue to work if you reauthenticate with GitHub. ([\#388](https://github.com/matrix-org/matrix-hookshot/issues/388))
- Floats in JSON payloads sent to generic webhooks are now handled properly. See the [documentation](https://matrix-org.github.io/matrix-hookshot/1.8.0/setup/webhooks.html#webhook-handling) for more information. ([\#396](https://github.com/matrix-org/matrix-hookshot/issues/396))
- Allow replying with the proper notice message when a widget is set up. ([\#403](https://github.com/matrix-org/matrix-hookshot/issues/403))
- Stringify provision connection data object in logs. ([\#404](https://github.com/matrix-org/matrix-hookshot/issues/404))
- Fix an issue where GitLab repos could not be bridged if they were already bridged to another room. ([\#406](https://github.com/matrix-org/matrix-hookshot/issues/406))


Improved Documentation
----------------------

- Clarify wording in Generic Hook Setup docs ([\#381](https://github.com/matrix-org/matrix-hookshot/issues/381))
- Mention RSS/Atom feed support in the project's README. ([\#389](https://github.com/matrix-org/matrix-hookshot/issues/389))
- Mention that the GitLab test hooks button doesn't send properly formed requests in all cases, and should not be relied upon when testing Hookshot. ([\#398](https://github.com/matrix-org/matrix-hookshot/issues/398))
- Correct some typos in documentation pages. ([\#401](https://github.com/matrix-org/matrix-hookshot/issues/401))


Deprecations and Removals
-------------------------

- Generic webhooks will no longer respond to `GET` requests by default. Users should consider using the `POST` or `PUT` methods instead.
  `GET` support can be enabled using the config flag `generic.enableHttpGet`. ([\#397](https://github.com/matrix-org/matrix-hookshot/issues/397))


Internal Changes
----------------

- Add a .node-version file. ([\#376](https://github.com/matrix-org/matrix-hookshot/issues/376))
- Enable CI for Node 18. ([\#399](https://github.com/matrix-org/matrix-hookshot/issues/399))


1.7.3 (2022-06-09)
==================

Bugfixes
--------

- Reinstate missing `github` authentication commands in admin room. ([\#372](https://github.com/matrix-org/matrix-hookshot/issues/372))


1.7.2 (2022-06-08)
==================

Features
--------

- Add support for GitHub enterprise. You can now specify the URL via `enterpriseUrl` in the config file. ([\#364](https://github.com/matrix-org/matrix-hookshot/issues/364))
- Add ability for bridge admins to remove GitHub connections using the admin room. ([\#367](https://github.com/matrix-org/matrix-hookshot/issues/367))


Bugfixes
--------

- Fix Github API URLs ([\#366](https://github.com/matrix-org/matrix-hookshot/issues/366))


Improved Documentation
----------------------

- Add CONTRIBUTING.md guide. ([\#134](https://github.com/matrix-org/matrix-hookshot/issues/134))
- Suggest using https for cloning hookshot, rather than git. ([\#355](https://github.com/matrix-org/matrix-hookshot/issues/355))


Internal Changes
----------------

- Widgets now request the RequireClient permission to verify the users identity. ([\#370](https://github.com/matrix-org/matrix-hookshot/issues/370))


1.7.1 (2022-05-23)
==================

Bugfixes
--------

- Match UserAgent version to Hookshot's version. Fixes #359. Thanks to @tadzik ([\#360](https://github.com/matrix-org/matrix-hookshot/issues/360))
- Fixed an issue that prevented GitLab repo connections from working if GitHub support is disabled. ([\#362](https://github.com/matrix-org/matrix-hookshot/issues/362))


Internal Changes
----------------

- Update towncrier to 21.9.0 ([\#353](https://github.com/matrix-org/matrix-hookshot/issues/353))


1 (2022-05-12)
==============

No significant changes.


1.7.0 (2022-05-12)
===================

Features
--------

- Improve GitLab push hook formatting: markdown commit hashes, link "N commits" to the list of commits, if there are more commits than can be shown only link instead, and show commiter unless a single person committed and pushed. ([\#309](https://github.com/matrix-org/matrix-hookshot/issues/309))
- Add `widgets.openIdOverrides` config option for developers to statically define server name <-> federation endpoints for openId lookups. ([\#326](https://github.com/matrix-org/matrix-hookshot/issues/326))
- Add a new setup widget for feeds ([\#345](https://github.com/matrix-org/matrix-hookshot/issues/345))


Bugfixes
--------

- Docker images can now be built cross-platform. Thanks @ptman for getting arm64 builds going! ([\#339](https://github.com/matrix-org/matrix-hookshot/issues/339))
- Fix regression where GitHubRepo and GitLabRepo connection config options were not being honoured ([\#346](https://github.com/matrix-org/matrix-hookshot/issues/346))


Improved Documentation
----------------------

- Fix spacing of non-emoji icons in the docs navbar ([\#341](https://github.com/matrix-org/matrix-hookshot/issues/341))


1.6.1 (2022-05-06)
==================

Bugfixes
--------

- Fix a bug where widgets would not load if hosted on a subpath (e.g. `/hookshot` instead of `/`) ([\#340](https://github.com/matrix-org/matrix-hookshot/issues/340))


1.6.0 (2022-05-06)
==================

Features
--------

- Add new `hookshot_connection_event(_failed)` metrics for tracking succesful event handling.
  Reinstate `matrix_*` metrics which were previously not being recorded. ([\#312](https://github.com/matrix-org/matrix-hookshot/issues/312))
- Send a notice when a GitLab merge request gets some review comments. ([\#314](https://github.com/matrix-org/matrix-hookshot/issues/314))
- Add RSS/Atom feed support ([\#315](https://github.com/matrix-org/matrix-hookshot/issues/315))
- Add support for GitLab in the widgets configuration UI. ([\#320](https://github.com/matrix-org/matrix-hookshot/issues/320))
- Add new `!hookshot gitlab project` command to configure project bridges in rooms. See [the docs](https://matrix-org.github.io/matrix-hookshot/latest/usage/room_configuration/gitlab_project.html) for instructions. ([\#321](https://github.com/matrix-org/matrix-hookshot/issues/321))


Internal Changes
----------------

- Reduce Docker image size. ([\#319](https://github.com/matrix-org/matrix-hookshot/issues/319))
- Refactor connection handling logic to improve developer experience. ([\#330](https://github.com/matrix-org/matrix-hookshot/issues/330))
- Restructure widget web components. ([\#332](https://github.com/matrix-org/matrix-hookshot/issues/332))
- Replace 'snowpack' with 'vite' for building the widget web components. ([\#334](https://github.com/matrix-org/matrix-hookshot/issues/334))
- The docker image has been shrunk by 78%, and now takes up 300MB. ([\#336](https://github.com/matrix-org/matrix-hookshot/issues/336))


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
