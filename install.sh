#!/usr/bin/env bash
#
# Blysis one-command installer.
#
#   curl -fsSL https://blysis.com/install.sh | sudo bash
#   (the same script as https://raw.githubusercontent.com/INOVIXI/blysis/main/install.sh)
#
# Installs Docker if it is missing, generates every secret, writes .env,
# pulls the prebuilt image, starts the stack, waits until the app answers,
# and prints the URL and admin credentials.
#
# Re-running it is an upgrade: an existing .env is never overwritten, so
# secrets and answers survive. See `blysis update` for the short form.
#
# Flags (all optional - without them the installer asks three questions):
#   --dir PATH        install root                        (default /opt/blysis)
#   --domain HOST     public hostname; empty means "use the server IP"
#   --email ADDR      admin account e-mail
#   --tls / --no-tls  run Caddy for automatic HTTPS (requires --domain)
#   --port N          host port when not using TLS                (default 3001)
#   --version TAG     image tag to install                     (default latest)
#   --build           build from the local source tree instead of pulling
#   --yes, -y         never prompt; use defaults for anything not given
#   --dry-run         compute everything, write to a temp dir, change nothing
#   --help
set -euo pipefail

REPO_SLUG="INOVIXI/blysis"
# Overridable so a fork can serve its own copies, and so the piped
# (`curl | bash`) path can be exercised against a local checkout in tests.
RAW_BASE="${BLYSIS_RAW_BASE:-https://raw.githubusercontent.com/${REPO_SLUG}/main}"
IMAGE_DEFAULT="ghcr.io/inovixi/blysis"
COMPOSE_FILES=(docker-compose.yml docker-compose.build.yml docker-compose.debug.yml Caddyfile updater.sh)

INSTALL_DIR="/opt/blysis"
DOMAIN=""
ADMIN_EMAIL=""
USE_TLS=""
APP_PORT="3001"
IMAGE_VERSION="latest"
FROM_SOURCE=0
ASSUME_YES=0
DRY_RUN=0
DIR_EXPLICIT=0

# ---------------------------------------------------------------- output ----
# Colours only when stdout is a terminal - `curl | bash > log` stays readable.
if [ -t 1 ]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
    C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
    C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""
fi

step() { printf '%s==>%s %s\n' "$C_CYAN$C_BOLD" "$C_RESET$C_BOLD" "$*$C_RESET"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s !  %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
ok()   { printf '%s ✓  %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
die()  { printf '\n%s ✗  %s%s\n\n' "$C_RED$C_BOLD" "$*" "$C_RESET" >&2; exit 1; }

usage() { sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ------------------------------------------------------------------ args ----
while [ $# -gt 0 ]; do
    case "$1" in
        --dir)      INSTALL_DIR="${2:?--dir needs a path}"; DIR_EXPLICIT=1; shift 2 ;;
        --domain)   DOMAIN="${2:?--domain needs a hostname}"; shift 2 ;;
        --email)    ADMIN_EMAIL="${2:?--email needs an address}"; shift 2 ;;
        --tls)      USE_TLS=1; shift ;;
        --no-tls)   USE_TLS=0; shift ;;
        --port)     APP_PORT="${2:?--port needs a number}"; shift 2 ;;
        --version)  IMAGE_VERSION="${2:?--version needs a tag}"; shift 2 ;;
        --build)    FROM_SOURCE=1; shift ;;
        --yes|-y)   ASSUME_YES=1; shift ;;
        --dry-run)  DRY_RUN=1; ASSUME_YES=1; shift ;;
        --help|-h)  usage ;;
        *)          die "Unknown option: $1 (try --help)" ;;
    esac
done

case "$APP_PORT" in
    ''|*[!0-9]*) die "--port must be a number, got '$APP_PORT'" ;;
esac
[ "$APP_PORT" -ge 1 ] && [ "$APP_PORT" -le 65535 ] || die "--port out of range: $APP_PORT"

# When run from a checked-out tree the stack files sit next to this script;
# when piped from curl there is no such directory and they come from GitHub.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
    # --dir is honoured so a test can inspect the generated .env; without it
    # the dry run picks a throwaway directory.
    [ "$DIR_EXPLICIT" -eq 1 ] || INSTALL_DIR="$(mktemp -d)/blysis"
    warn "Dry run: installing to $INSTALL_DIR, nothing else on this host is touched."
elif [ "$FROM_SOURCE" -eq 1 ]; then
    # docker-compose.build.yml sets `context: .`, which Compose resolves
    # relative to the compose file. Building therefore only works with the
    # compose files sitting in the source tree, so --build installs in place
    # rather than into /opt.
    [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/Dockerfile" ] || die "--build needs the source tree.
    Clone the repository and run ./install.sh --build from inside it."
    INSTALL_DIR="$SCRIPT_DIR"
    warn "Building from source: installing in place at $INSTALL_DIR"
fi

printf '\n%sBlysis installer%s\n\n' "$C_BOLD" "$C_RESET"

# -------------------------------------------------------------- platform ----
step "Checking the host"

[ "$(uname -s)" = "Linux" ] || die "This installer supports Linux only (found $(uname -s))."

if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
    die "Run as root: curl -fsSL ${RAW_BASE}/install.sh | sudo bash"
fi

PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG="apt"
elif command -v dnf >/dev/null 2>&1; then PKG="dnf"
fi

case "$(uname -m)" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) die "Unsupported CPU architecture: $(uname -m). The published image is amd64/arm64 only." ;;
esac
info "Linux/$ARCH${PKG:+, package manager: $PKG}"

# ---------------------------------------------------------------- docker ----
step "Checking Docker"

install_docker() {
    [ -n "$PKG" ] || die "Docker is missing and this distribution is not apt- or dnf-based.
    Install Docker Engine + the Compose v2 plugin yourself, then re-run this installer:
    https://docs.docker.com/engine/install/"
    info "Docker not found - installing via get.docker.com"
    if [ "$DRY_RUN" -eq 1 ]; then info "(dry run: skipped)"; return 0; fi
    local script; script="$(mktemp)"
    curl -fsSL https://get.docker.com -o "$script" || die "Could not download the Docker install script. Is this host online?"
    sh "$script" || die "The Docker install script failed. Install Docker manually and re-run."
    rm -f "$script"
    systemctl enable --now docker >/dev/null 2>&1 || true
}

if ! command -v docker >/dev/null 2>&1; then
    install_docker
fi

if [ "$DRY_RUN" -eq 0 ]; then
    command -v docker >/dev/null 2>&1 || die "Docker is still not on PATH after installation."
    docker info >/dev/null 2>&1 || die "The Docker daemon is not responding. Try: systemctl start docker"
    docker compose version >/dev/null 2>&1 || die "The Docker Compose v2 plugin is missing.
    Install docker-compose-plugin from your distribution, then re-run:
    https://docs.docker.com/compose/install/linux/"
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) with Compose $(docker compose version --short)"
else
    info "(dry run: Docker checks skipped)"
fi

# --------------------------------------------------------------- upgrade ----
ENV_FILE="$INSTALL_DIR/.env"
IS_UPGRADE=0
if [ -f "$ENV_FILE" ]; then
    IS_UPGRADE=1
    step "Existing installation found at $INSTALL_DIR"
    info "Its .env will be kept exactly as it is; this run only updates the stack."
fi

# --------------------------------------------------------------- answers ----
ask() {
    # ask <variable> <prompt> <default>
    local __var="$1" __prompt="$2" __default="$3" __reply=""
    # Testing `-t 0` here would be wrong: in the documented
    # `curl ... | sudo bash` form stdin IS the script, so every question would
    # silently take its default and the installer would never ask anything.
    # The terminal is still reachable as /dev/tty, which is what we read from;
    # a genuinely non-interactive context (cron, CI) has no /dev/tty and falls
    # back to the defaults.
    if [ "$ASSUME_YES" -eq 1 ] || [ ! -r /dev/tty ]; then
        printf -v "$__var" '%s' "$__default"
        return 0
    fi
    if [ -n "$__default" ]; then
        read -r -p "    $__prompt [$__default]: " __reply </dev/tty || true
    else
        read -r -p "    $__prompt: " __reply </dev/tty || true
    fi
    printf -v "$__var" '%s' "${__reply:-$__default}"
}

detect_public_ip() {
    local ip=""
    ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -n "$ip" ] || ip="127.0.0.1"
    printf '%s' "$ip"
}

if [ "$IS_UPGRADE" -eq 0 ]; then
    step "Configuration"
    PUBLIC_IP="$(detect_public_ip)"

    [ -n "$DOMAIN" ] || ask DOMAIN "Domain for this site (blank = use the server IP $PUBLIC_IP)" ""
    [ -n "$ADMIN_EMAIL" ] || ask ADMIN_EMAIL "Admin e-mail" "admin@${DOMAIN:-example.com}"

    if [ -n "$DOMAIN" ] && [ -z "$USE_TLS" ]; then
        ask TLS_ANSWER "Get an HTTPS certificate automatically? (y/n)" "y"
        case "$TLS_ANSWER" in [yY]*) USE_TLS=1 ;; *) USE_TLS=0 ;; esac
    fi
    [ -n "$USE_TLS" ] || USE_TLS=0

    if [ "$USE_TLS" -eq 1 ] && [ -z "$DOMAIN" ]; then
        die "TLS needs a domain - Let's Encrypt will not issue a certificate for a bare IP address."
    fi

    if [ "$USE_TLS" -eq 1 ]; then
        SITE_URL="https://$DOMAIN"
        APP_BIND_ADDR="127.0.0.1"   # only Caddy may reach the app
    elif [ -n "$DOMAIN" ]; then
        SITE_URL="http://$DOMAIN:$APP_PORT"
        APP_BIND_ADDR="0.0.0.0"
    else
        SITE_URL="http://$PUBLIC_IP:$APP_PORT"
        APP_BIND_ADDR="0.0.0.0"
    fi
fi

# ----------------------------------------------------------------- ports ----
port_in_use() {
    if command -v ss >/dev/null 2>&1; then
        ss -ltnH "sport = :$1" 2>/dev/null | grep -q . && return 0
    elif command -v netstat >/dev/null 2>&1; then
        netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
    fi
    return 1
}

port_holder() {
    if command -v ss >/dev/null 2>&1; then
        ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:((\"\([^\"]*\)\".*/\1/p' | head -1
    fi
}

if [ "$IS_UPGRADE" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
    step "Checking ports"
    if [ "$USE_TLS" -eq 1 ]; then
        CHECK_PORTS="80 443"
    else
        CHECK_PORTS="$APP_PORT"
    fi
    for p in $CHECK_PORTS; do
        if port_in_use "$p"; then
            holder="$(port_holder "$p")"
            die "Port $p is already in use${holder:+ by '$holder'}.
    Free it, or pick another port with --port N (HTTP installs only).
    A TLS install needs 80 and 443 specifically - Let's Encrypt validates over them."
        fi
    done
    ok "Ports free: $CHECK_PORTS"
fi

# --------------------------------------------------------------- payload ----
step "Fetching stack files"

mkdir -p "$INSTALL_DIR"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    if [ "$SCRIPT_DIR" = "$INSTALL_DIR" ]; then
        info "Installing in place at $INSTALL_DIR"
    else
        info "Using the source tree at $SCRIPT_DIR"
        for f in "${COMPOSE_FILES[@]}"; do
            cp "$SCRIPT_DIR/$f" "$INSTALL_DIR/$f"
        done
    fi
    if [ -f "$SCRIPT_DIR/scripts/blysis" ]; then
        cp "$SCRIPT_DIR/scripts/blysis" "$INSTALL_DIR/blysis.cli"
    fi
else
    if [ "$FROM_SOURCE" -eq 1 ]; then
        die "--build needs the source tree. Clone the repository and run ./install.sh --build from inside it."
    fi
    info "Downloading from $REPO_SLUG"
    for f in "${COMPOSE_FILES[@]}"; do
        curl -fsSL "$RAW_BASE/$f" -o "$INSTALL_DIR/$f" || die "Could not download $f from $RAW_BASE."
    done
    curl -fsSL "$RAW_BASE/scripts/blysis" -o "$INSTALL_DIR/blysis.cli" || true
fi
ok "Stack files in $INSTALL_DIR"

# ------------------------------------------------------------------- env ----
# URL-safe by construction. POSTGRES_PASSWORD in particular is interpolated
# into postgresql://blysis:<pw>@db:5432/blysis, where a '/', '@' or ':' from
# base64 would silently corrupt the connection string.
gen_hex()  { openssl rand -hex "$1"; }
gen_b64url() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '='; }

if [ "$IS_UPGRADE" -eq 0 ]; then
    step "Generating secrets"
    command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets but was not found."

    POSTGRES_PASSWORD="$(gen_hex 24)"
    AUTH_SECRET="$(gen_b64url 32)"
    SECRET_ENCRYPTION_KEY="$(gen_hex 32)"
    SEED_ADMIN_PASSWORD="$(gen_b64url 18)"

    umask 077
    cat > "$ENV_FILE" <<ENVEOF
# Generated by install.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC').
#
# Every secret below was generated on this machine and exists nowhere else.
# Back this file up: without it the database rows encrypted with
# SECRET_ENCRYPTION_KEY cannot be read again.
#
# Safe to edit. Apply changes with: blysis restart

NODE_ENV=production

# --- generated secrets ---
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
AUTH_SECRET=$AUTH_SECRET
SECRET_ENCRYPTION_KEY=$SECRET_ENCRYPTION_KEY

# --- first admin account (created once, on the very first boot) ---
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$SEED_ADMIN_PASSWORD

# --- public address ---
# AUTH_URL is the canonical URL: OAuth callbacks, password-reset links,
# sitemap.xml, robots.txt and every OpenGraph tag are built from it.
AUTH_URL=$SITE_URL
NEXTAUTH_URL=$SITE_URL
DOMAIN=$DOMAIN
TLS_EMAIL=$ADMIN_EMAIL

# --- how the app is published on this host ---
APP_BIND_ADDR=$APP_BIND_ADDR
APP_PORT=$APP_PORT

# --- image ---
BLYSIS_IMAGE=$IMAGE_DEFAULT
BLYSIS_VERSION=$IMAGE_VERSION
ENVEOF
    chmod 600 "$ENV_FILE"
    ok "Secrets written to $ENV_FILE (mode 600)"
else
    # Re-read what the previous run decided so the summary and health check
    # target the right address.
    # shellcheck disable=SC1090
    SITE_URL="$(grep -E '^AUTH_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
    APP_PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
    DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
    APP_PORT="${APP_PORT:-3001}"
    USE_TLS=0
    if [ -n "$DOMAIN" ]; then
        case "$SITE_URL" in https://*) USE_TLS=1 ;; esac
    fi
fi

# --------------------------------------------------------------- compose ----
COMPOSE_ARGS=(-f docker-compose.yml)
if [ "$FROM_SOURCE" -eq 1 ]; then COMPOSE_ARGS+=(-f docker-compose.build.yml); fi
if [ "${USE_TLS:-0}" -eq 1 ]; then COMPOSE_ARGS+=(--profile tls); fi

compose() { ( cd "$INSTALL_DIR" && docker compose "${COMPOSE_ARGS[@]}" "$@" ); }

if [ "$DRY_RUN" -eq 1 ]; then
    step "Dry run complete"
    info "Install dir : $INSTALL_DIR"
    info "Site URL    : ${SITE_URL:-<unset>}"
    info "Compose     : docker compose ${COMPOSE_ARGS[*]} up -d"
    printf '\n%s--- generated .env ---%s\n' "$C_DIM" "$C_RESET"
    sed -E 's/^(POSTGRES_PASSWORD|AUTH_SECRET|SECRET_ENCRYPTION_KEY|SEED_ADMIN_PASSWORD)=.*/\1=<generated>/' "$ENV_FILE"
    printf '\n'
    exit 0
fi

step "Starting Blysis"
if [ "$FROM_SOURCE" -eq 1 ]; then
    info "Building the image from source - this takes a few minutes."
    compose build || die "The image build failed. The output above says why."
else
    info "Pulling ${IMAGE_DEFAULT}:${IMAGE_VERSION}"
    pull_log="$(mktemp)"
    if ! compose pull 2>&1 | tee "$pull_log" | sed 's/^/    /'; then
        # Say which failure it was. A network blip used to be reported as
        # "the tag does not exist, or the package is private", which sends the
        # reader looking for a problem that is not there - when running the
        # same command again was the whole fix.
        if grep -qiE 'i/o timeout|timed out|connection (refused|reset)|no such host|TLS handshake|network is unreachable|temporary failure' "$pull_log"; then
            reason="The registry could not be reached (a network error, above).
    Run the same command again: it picks up where it stopped, and your
    .env and secrets are kept."
        elif grep -qiE 'unauthorized|denied|forbidden' "$pull_log"; then
            reason="The registry refused the pull: the GHCR package is private,
    or this host is logged in to ghcr.io with an account that cannot read it."
        elif grep -qiE 'manifest unknown|not found' "$pull_log"; then
            reason="There is no image tagged '${IMAGE_VERSION}'. Check the tag, or omit
    --version to install the latest release."
        else
            reason="The output above says why."
        fi
        rm -f "$pull_log"
        die "Could not pull ${IMAGE_DEFAULT}:${IMAGE_VERSION}.
    ${reason}
    To install from source instead, clone the repository and run:
        ./install.sh --build"
    fi
    rm -f "$pull_log"
fi

compose up -d || die "The stack failed to start. Run 'blysis logs' to see why."

# ---------------------------------------------------------------- health ----
step "Waiting for the app"
HEALTH_URL="http://127.0.0.1:$APP_PORT/api/health"
# A first install boots in well under a minute. Re-running the installer over
# an existing install is an upgrade, though, and an upgrade on a site with
# modules recompiles them before the app serves anything - minutes, not
# seconds. The wait has to
# cover the slow case or the installer reports a failure for a healthy boot.
HEALTH_TIMEOUT=900
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
HEALTHY=0
NOTIFIED=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then HEALTHY=1; break; fi
    if [ "$NOTIFIED" -eq 0 ] && [ "$(date +%s)" -gt $(( DEADLINE - HEALTH_TIMEOUT + 45 )) ]; then
        NOTIFIED=1
        info "Still starting. On an upgrade with modules installed the app
  recompiles them first - several minutes is normal."
    fi
    sleep 3
done

if [ "$HEALTHY" -eq 0 ]; then
    warn "The app did not answer $HEALTH_URL within $HEALTH_TIMEOUT seconds. Last 50 log lines:"
    compose logs --tail=50 2>&1 | sed 's/^/    /' >&2
    die "Installation did not complete. The stack is still running - inspect it with 'blysis logs'."
fi
ok "Healthy"

# ------------------------------------------------------------------- cli ----
HAVE_CLI=0
if [ -f "$INSTALL_DIR/blysis.cli" ]; then
    install -m 0755 "$INSTALL_DIR/blysis.cli" /usr/local/bin/blysis
    rm -f "$INSTALL_DIR/blysis.cli"
    printf 'BLYSIS_DIR=%s\n' "$INSTALL_DIR" > /etc/blysis.conf
    chmod 644 /etc/blysis.conf
    HAVE_CLI=1
    ok "Installed the 'blysis' command"
else
    # Only reachable when the download of scripts/blysis failed; the stack
    # itself is up, so say what is missing instead of implying a broken install.
    warn "Could not install the 'blysis' helper - manage the stack with
    'cd $INSTALL_DIR && docker compose ...' instead."
fi

# --------------------------------------------------------------- summary ----
printf '\n%s%s Blysis is running%s\n\n' "$C_GREEN" "$C_BOLD" "$C_RESET"

if [ "$IS_UPGRADE" -eq 1 ]; then
    printf '  %sUpdated in place.%s Your .env and database were left untouched.\n\n' "$C_BOLD" "$C_RESET"
    printf '  Address     %s\n' "$SITE_URL"
else
    ADMIN_PW="$(grep -E '^SEED_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
    printf '  Address     %s%s%s\n' "$C_BOLD" "$SITE_URL" "$C_RESET"
    printf '  Admin       %s\n' "$ADMIN_EMAIL"
    printf '  Password    %s%s%s\n' "$C_BOLD" "$ADMIN_PW" "$C_RESET"
    printf '\n  %sChange the password after your first sign-in.%s\n' "$C_YELLOW" "$C_RESET"
    printf '  It is also stored in %s - back that file up.\n' "$ENV_FILE"
    if [ -n "$DOMAIN" ] && [ "${USE_TLS:-0}" -eq 1 ]; then
        printf '\n  %sPoint %s at this server before the certificate can be issued.%s\n' "$C_DIM" "$DOMAIN" "$C_RESET"
    fi
fi

if [ "$HAVE_CLI" -eq 1 ]; then
    printf '\n  %sblysis update%s    pull the newest version and restart\n' "$C_BOLD" "$C_RESET"
    printf '  %sblysis backup%s    dump the database into %s/backups\n' "$C_BOLD" "$C_RESET" "$INSTALL_DIR"
    printf '  %sblysis logs%s      follow the logs\n' "$C_BOLD" "$C_RESET"
    printf '  %sblysis status%s    show what is running\n\n' "$C_BOLD" "$C_RESET"
else
    printf '\n'
fi
