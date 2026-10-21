# Dependencies held back

Three dependencies are behind their latest major on purpose. Each was upgraded, failed and rolled back, more than once, because the reason had not been written down. Every entry carries the command that tells you when it can move. Last checked 2026-10-21.

## `eslint` at 9

`eslint-config-next` brings its own `eslint-plugin-react`, whose latest stable release declares `eslint: ^3 || ... || ^9.7` and calls `context.getFilename()`, which ESLint 10 removed. Upgrading fails before a single file is linted:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
```

It can move when `npm view eslint-plugin-react@latest peerDependencies` includes `^10`.

## `typescript` at 6

`typescript-eslint` declares `typescript: >=4.8.4 <6.1.0`. TypeScript 7 type-checks this codebase, but `npm run lint` refuses to run against it. The documented workaround is a second, aliased TypeScript for the linter alone, and two type checkers disagreeing about one codebase is worse than being a major behind.

It can move when `npm view typescript-eslint@latest peerDependencies` allows it.

## `next-auth` at `5.0.0-beta.32`

A beta authentication library in production is the largest standing risk in the dependency tree, and it is not held back by choice: beta.32 is the newest v5, and `latest` points at v4, a different API. There is nowhere better to go.

`npm view next-auth dist-tags` shows when a stable 5.x exists. Moving to it then comes before anything else on this page.

## `overrides`

`package.json` carries an `overrides` block. Most entries pin a transitive dependency past a published advisory, because `npm audit --omit=dev --audit-level=high` is a CI gate. An entry can go once its upstream has moved past the advisory on its own; check with `npm audit` after removing it, never by assumption.
