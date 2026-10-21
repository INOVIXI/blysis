# Conventions as tests

Most rules in [AGENTS.md](../../AGENTS.md) are enforced by tests in `tests/unit/` that read the repository as text: that core names no module, that a colour comes from the theme, that a refusal carries an `error`, that every string is in every locale. We call them gates.

## Why tests and not lint rules

A gate can read anything: a translation catalogue, a manifest, a workflow, a SQL file, two files at once. Lint sees one TypeScript file at a time. A gate can also tell its whole story. Its file name states the rule as a sentence, and its doc comment records the incident that made the rule necessary, which is what stops the next person from deleting it as fussy.

The cost is that a gate is code that reads code, and it can be wrong in ways that pass.

## A gate must be able to fail

Each of these let a gate pass while checking nothing. Each happened here.

- **A spawned tool that is missing.** Gates listed files with `sh -c "ls ..."` and searched with `grep`, inside a `try` whose `catch` returned an empty list. Neither tool exists on a Windows PATH, so there every gate found nothing and passed. Read the tree with Node: `grepTree` and `moduleSourceDirs` in `tests/unit/source-text.ts`. `tests/unit/a-test-reads-the-tree-without-a-shell.test.ts` keeps shell tools out.
- **A path compared in one spelling.** A filter on `"/module-sources/"` matches nothing when the separator is a backslash. Compare through `relativePath`, which always answers with forward slashes.
- **A scan that read nothing.** Assert a floor: the number of files read, or that the one file the gate exists to protect was among them.
- **A pattern narrower than the rule.** `NextResponse.json` and not `Response.json`; `prisma.x.create` and not `tx.x.create`; double quotes and not single. When you write a gate, write the cases it must refuse as fixtures beside it, and run them.
- **An allow-list that outlived its file.** An exemption for a deleted path excuses whatever takes that name next. Assert that every entry names a file that exists, and give each a reason a reviewer would accept.
- **A mock of nothing.** Vitest accepts `vi.mock` of a path that does not exist and says nothing; the real module then runs. `tests/unit/a-mock-names-a-module-that-exists.test.ts` resolves every mocked specifier.

When you change a gate, make it fail first: put back the code it exists to refuse, or run the old rule against the new fixture, and watch it go red.

## A gate is not a feature test

A gate holds a convention. Whether a feature works is a behaviour test: call the route, render the screen, run the job, and look at what comes back. A test that searches a route's source for the name of the function it should call passes when the call is in a comment, and fails when the code is renamed but still right. Where the behaviour can be run, run it.
