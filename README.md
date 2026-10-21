<div align="center">
  <h1>Blysis</h1>

  <p><strong>A plugin-first platform whose core ships empty.</strong></p>
  <p>Game-server websites, digital storefronts and community portals. Every feature is a module installed from a built-in marketplace, and every look is a theme.</p>

  [![CI](https://github.com/INOVIXI/blysis/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/INOVIXI/blysis/actions/workflows/build-and-test.yml)
  [![Release](https://img.shields.io/github/v/release/INOVIXI/blysis?display_name=tag&sort=semver)](https://github.com/INOVIXI/blysis/releases)
  [![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
</div>

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/INOVIXI/blysis/main/install.sh | sudo bash
```

One command on a fresh VPS. It installs Docker if the machine lacks it, generates every secret, starts the site and prints its URL and the admin password. Give it a domain and it also obtains and renews an HTTPS certificate. Open the site, finish the setup wizard, and install modules from **Admin > Modules**.

[Installing](./docs/user/install.md) and [keeping a site running](./docs/user/running.md) cover the options, updates, backups and troubleshooting.

## How it is built

The core knows nothing about any module or theme. It is site-type-agnostic infrastructure (accounts, roles, translations, navigation, uploads, mail, scheduling) and reaches modules only through registries generated from their manifests. A module imports core only through its SDK, and modules talk to each other through hooks and slots, never imports. Tests fail the build when any of that stops being true.

Modules are compiled, not loaded: installing one rebuilds the site beside the build being served and restarts the process onto it. Run it under a supervisor (the Docker install already does) and start it through `npm start`, never a bare `next start`. [How an install becomes a build](./docs/internals/build-lifecycle.md) explains why.

## Develop

Requires Node.js 24+, and Docker or a PostgreSQL 14+ of your own. The app runs on the host on Linux, macOS or Windows; Docker provides the database and Redis.

```bash
git clone https://github.com/INOVIXI/blysis.git
cd blysis
npm install
npm run services:up        # Postgres and Redis on 127.0.0.1
cp .env.example .env       # then set AUTH_SECRET
npm run db:push            # a fresh database only
npm run db:seed            # prints the admin password once
npx tsx scripts/seed-translations.ts
npm run dev                # http://localhost:3001
```

`npm run verify` runs every gate CI runs. The [development runbook](./docs/operations/development.md) covers working with modules, the test suites and Windows.

## Documentation

- [docs/](./docs/README.md): running a site, working on Blysis, and the internal notes
- [CONTRIBUTING.md](./CONTRIBUTING.md): what a pull request needs before it is reviewed
- [AGENTS.md](./AGENTS.md): the rules for working in the code, for people and agents alike
- [Writing a module](./module-template/README.md)
- [SECURITY.md](./SECURITY.md): reporting a vulnerability; [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## License

MIT. See [LICENSE](LICENSE).
