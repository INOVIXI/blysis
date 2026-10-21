# Keep it running

Everything here uses the `blysis` command the installer put on the server.

| Command | What it does |
|---|---|
| `blysis status` | what is running, and whether the site answers |
| `blysis logs [SERVICE]` | follow the logs; the service is `app`, `db`, `redis`, `caddy` or `migrate` |
| `blysis update [TAG]` | move to the newest release, or to `TAG` |
| `blysis backup` | dump the database into the install directory's `backups/` |
| `blysis restore FILE` | replace the database with a dump |
| `blysis restart` | restart everything |
| `blysis stop` / `blysis start` | stop and start again; nothing is lost |
| `blysis version` | the release that is installed |

## Updating

**Admin > Updates** shows the version the site runs and the one it can move to. Updating from there puts the site into maintenance, takes a database backup and restarts on the new version. A release marked as a security release is one to install soon.

`blysis update` does the same from the server. Given a tag, it pins the site to that release, and a later plain `blysis update` stays on it until you name another.

The first start on a new release can take several minutes when modules are installed, because their pages are compiled into the site again for that version. The site comes back on its own; `blysis logs app` shows the progress. If a release from the panel does not come up healthy, the previous one is put back.

Updates only ever add to the database, which is why going back to the previous release is safe.

## Backups

**Admin > Backup** takes a backup now, downloads or restores one, and runs them on a schedule, keeping as many as you choose. From the server, `blysis backup` writes a compressed dump to `backups/` in the install directory.

A dump does not contain `.env`. The site's stored credentials (payment keys, mail passwords, OAuth secrets) are encrypted with a key that lives there, and a restored database cannot read them without it. Keep a copy of `.env` somewhere safe, apart from the dumps.

`blysis restore FILE` stops the site, replaces the database with the dump and starts it again. It asks you to type `restore` first, because everything since the dump is lost.

A backup is also taken automatically before a module is installed, updated or removed.

## When something is wrong

- `blysis status` says whether the site answers. If it does not, `blysis logs app` usually says why.
- A site that answers every request with "too many requests" in production has lost Redis: rate limiting denies rather than letting traffic through unchecked. `blysis logs redis`.
- A site behind your own reverse proxy that sees every visitor as the same address needs `TRUSTED_PROXY_IPS` set in `.env`; see [.env.example](../../.env.example).
