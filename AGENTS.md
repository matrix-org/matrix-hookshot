# AGENTS.md

Instructions for AI coding agents working in Matrix Hookshot. Read
[CONTRIBUTING.md](./CONTRIBUTING.md) and [the development setup guide](./docs/dev/setup.md)
for contributor and environment guidance. This file records the repository details
and review standards that are easy to miss.

## Repository layout

Hookshot is a pnpm workspace with a TypeScript bridge, a Rust N-API library, a
Preact widget, and an optional Element Web module. It is not the Element Web
monorepo described in `docs/dev/ew_AGENTS.md`.

| Path            | Contents                                                                                                    |
| ----------------| ----------------------------------------------------------------------------------------------------------- |
| `src/`          | Bridge, connections, service integrations, configuration, and Rust source (`*.rs`).                         |
| `web/`          | Preact configuration widget and SCSS styles.                                                                |
| `modules/`      | Element Web modules, React views, view models, CSS modules, Storybook stories, and module tests.            |
| `tests/`        | Bridge unit tests.                                                                                          |
| `spec/`         | Integration tests using testcontainers and a Matrix homeserver.                                             |
| `docs/`         | mdBook documentation; `docs/dev/` contains development guidance.                                            |
| `changelog.d/`  | Towncrier newsfiles.                                                                                        |
| `helm/`         | Helm chart.                                                                                                 |

Generated output includes `lib/`, `target/`, `public/`, `storybook-static/`,
`book/`, and `src/libRs.d.ts`. Edit sources instead of generated output.

## Commands

Run these from the repository root unless a command says otherwise. Use the
Node version in `.node-version`, pnpm, and a Rust toolchain.

| Task                                                     | Command              |
| -------------------------------------------------------- | -------------------- |
| Build everything, including Rust bindings and the module | `pnpm build`         |
| Check JavaScript/TypeScript formatting and lint          | `pnpm lint:js`       |
| Apply JavaScript/TypeScript formatting and lint fixes    | `pnpm lint:js:apply` |
| Typecheck app, widget, tests, Storybook, and workspaces  | `pnpm lint:types`    |
| Check Rust formatting and Clippy                         | `pnpm lint:rs`       |
| All lint checks                                          | `pnpm lint`          |
| Unit and module tests                                    | `pnpm test`          |
| Unit coverage and module tests                           | `pnpm test:cover`    |
| Integration and module tests                             | `pnpm test:e2e`      |
| Build documentation                                      | `pnpm build:docs`    |
| Run Storybook                                            | `pnpm storybook`     |

Formatting is **Prettier** and linting is **ESLint**. Follow their configuration
and the style of adjacent code; do not apply Element Web's oxfmt/oxlint rules.
Avoid running `lint:js:apply` across the whole tree for a focused change if it
would produce unrelated formatting diffs.

When changing configuration defaults, regenerate `config.sample.yml` with
`pnpm generate-default-config` and review the diff. When changing generated
metrics documentation, run `pnpm build:docs` and review `docs/metrics.md`.
CI checks both generated files against their sources.

## Running tests

Vitest uses separate configurations. **The file location decides the suite.**

| Test file              | Command for one file                                                                              |
| -----------------------| --------------------------------------------------------------------------------------------------|
| `tests/**/*.spec.ts`   | `pnpm exec vitest --config vitest.unit.config.ts run tests/<path>.spec.ts`                        |
| `spec/*.spec.ts`       | `pnpm exec vitest run spec/<name>.spec.ts`                                                        |
| `modules/**/*.spec.ts` | `cd modules/*/element-web && pnpm exec vitest --config vitest.config.ts run tests/<name>.spec.ts` |

- Import `describe`, `it`/`test`, `expect`, and hooks explicitly from `vitest`.
- Prefer extending a related test file when it already covers the behavior.
  Place new tests in the suite for the code they exercise.
- `spec/` tests start a homeserver and Redis through testcontainers. They need
  a working container runtime and a built app (`pnpm build`). A container or
  port failure is an environment failure, not evidence that behavior passed.
- “No test files found” is not a pass: check the path and Vitest config.
- Add unit coverage for behavioral changes. For a new or changed integration
  flow, add a relevant `spec/` happy path, including failure and permission
  cases when those are part of the behavior. For docs or formatting only,
  tests are unnecessary; say which checks were run.
- Review any changed screenshots or other generated fixtures visually and
  investigate unrelated changes before including them.

## Code style

- Write new bridge and widget code in TypeScript; Rust belongs in the existing
  N-API library. Keep public contracts typed. Avoid `any`; explain any
  unavoidable use close to the code.
- Let Prettier control indentation, quotes, semicolons, and line wrapping.
  Existing TypeScript normally uses two spaces and double quotes. Run the
  relevant linter rather than imposing style from another repository.
- Prefer named exports for new APIs where the framework and surrounding code
  permit them. Preserve existing default export contracts when changing them.
- Keep changes focused. Separate behavior, refactoring, and formatting so the
  review can identify the effect of each.
- Add TSDoc for new exported APIs and component props. In implementation
  comments, explain why a non-obvious step is needed, not what each line does.
  Update nearby comments when behavior changes. Explain lint or type
  suppressions beside them.
- Do not copy Element Web's AGPL copyright header into this Apache-2.0
  project. Follow existing file headers and license conventions in this repo.

### UI code

- The `web/` widget uses Preact and SCSS, including `*.module.scss` in
  components. Follow its established component and styling patterns.
- The Element-web modules uses React views in
  `modules/*/element-web/src/components/`, view models in
  `src/viewmodels/`, and `*.module.css`. Keep views concerned with rendering
  snapshots and invoking actions; keep event interpretation and state changes
  in the view model or domain layer. Use Compound design tokens for module
  styling and add or update Storybook stories for new visual states.
- Use semantic, accessible names for controls and links. Validate and handle
  untrusted event content before rendering URLs, colors, or rich text.

## Commits and pull requests

- Keep commits to one logical concern. Use a short imperative subject without
  a conventional-commit prefix; add a brief body only when the diff needs it.
- Follow the contribution sign-off requirement checked by CI. If creating a
  commit, include the sign-off trailer (`git commit -s`).
- Add a Towncrier fragment under `changelog.d/` for changes that need a
  release note, using PR number and the appropriate suffix from
  `pyproject.toml` (`feature`, `bugfix`, `doc`, `removal`, or `misc`). CI checks
  for a newsfile on PRs unless the PR has the `T-Task` label.
- Leave PR creation to the human unless explicitly asked to create one.
