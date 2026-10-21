# Install Blysis

Blysis runs on a Linux server with Docker. The installer sets up everything else.

## One command

On a fresh VPS, as a user that can use `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/INOVIXI/blysis/main/install.sh | sudo bash
```

It installs Docker if the machine does not have it, generates every secret, writes the configuration, pulls the prebuilt image, starts the database, Redis and the site, waits until the site answers, and prints its address and the admin password. Copy the password before the terminal scrolls.

It asks three questions, each with a default:

- **Domain.** Leave it blank to use the server's IP address; see [Adding a domain later](#adding-a-domain-later).
- **Admin e-mail.** The account you sign in with.
- **HTTPS.** With a domain, it can obtain and renew a certificate on its own. Point the domain's DNS at the server first.

To answer them up front instead, pass flags:

| Flag | What it does |
|---|---|
| `--domain HOST` | the public hostname; without it the site is served on the server's IP |
| `--email ADDR` | the admin account's e-mail |
| `--tls` / `--no-tls` | automatic HTTPS; needs `--domain` |
| `--port N` | the port when HTTPS is off (default 3001) |
| `--dir PATH` | where it installs (default `/opt/blysis`) |
| `--version TAG` | a specific release instead of the latest |
| `--yes` | never ask; use the defaults for anything not given |
| `--dry-run` | work everything out and change nothing |

Running the installer again is an upgrade. It never overwrites the existing configuration, so your secrets and answers stay.

## After it finishes

Open the address it printed and finish the setup wizard: the site's details, what kind of site it is, a theme and a first set of modules. Anything it skips can be added later from **Admin > Modules**; see [Modules and themes](./modules-and-themes.md).

The server now has a `blysis` command for everything else; see [Keep it running](./running.md).

## What is reachable from outside

Only the site: port 80 and 443 with HTTPS, or the port you chose without it. The database and Redis are not published on any port. Keep `.env` in the install directory private; it holds the keys that encrypt the site's stored credentials, and a backup without it cannot read them.

## Adding a domain later

Running the installer again keeps `.env` exactly as it is, so it will not ask for a domain a second time. Point the domain's DNS at the server, then edit `.env` in the install directory:

```bash
DOMAIN=shop.example.com
AUTH_URL=https://shop.example.com
NEXTAUTH_URL=https://shop.example.com
APP_BIND_ADDR=127.0.0.1
```

and run `blysis start`. An `https://` address together with a `DOMAIN` is what turns on the HTTPS proxy, which obtains the certificate on its own; `APP_BIND_ADDR=127.0.0.1` stops the site being reachable around it on the old port.

## Configuration

Everything the site reads from its environment is in `.env` in the install directory, and every setting is explained in [.env.example](../../.env.example). Most of what an admin changes lives in the panel instead, under **Admin > Settings**. After editing `.env`, run `blysis restart`.
