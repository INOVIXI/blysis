# Blysis docs

## Running a Blysis site

- [Install Blysis](./user/install.md)
- [Keep it running: updates, backups, logs](./user/running.md)
- [Modules and themes](./user/modules-and-themes.md)

---

## Working on Blysis

Start with the [development runbook](./operations/development.md) and the [contribution policy](../CONTRIBUTING.md). The rules for working in the code are in [AGENTS.md](../AGENTS.md).

- [Releasing a version](./operations/release.md)
- [Publishing a module to the marketplace](./operations/marketplace.md)
- [Writing a module](../module-template/README.md)

Internal notes keep the decisions, constraints and traps the source alone does not explain. Most changes do not need one; follow the [documentation rules](../AGENTS.md#documentation) before adding to them.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [How an install becomes a build](./internals/build-lifecycle.md)
- [Database: schema, additions and migrations](./internals/database.md)
- [Conventions as tests](./internals/gates.md)
- [Dependencies held back](./internals/dependencies.md)
