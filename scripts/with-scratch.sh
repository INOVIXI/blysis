#!/usr/bin/env bash
#
# Run a command with this repository's own scratch directory.
#
# Measured on the development box on 2026-09-20: /tmp is a 32 GB tmpfs shared
# with nine other projects on the same machine, and it reached zero bytes free
# while the suite was running. The failures that produces do not look like what
# they are - `cp: error writing ... No space left on device` from inside a test
# that stands up a temp module, a Chromium that dies before the login form,
# `pwd: write error` from the shell itself - and one of them, an install route
# refusing with 507 because statfs reported under 100 MB free, read for a while
# like a regression in code that was correct.
#
# So the repository gets its own, on the real disk, gitignored. It is not only
# a workaround for a full box: two runs in parallel no longer share a scratch
# space, and `npm run clean` can take the whole thing back.
#
# TMPDIR is what Node's os.tmpdir(), vitest, Next and Playwright all read.
set -euo pipefail

SCRATCH="${PWD}/.tmp"
mkdir -p "$SCRATCH"

export TMPDIR="$SCRATCH"
# Some tools read the other two; keeping all three in step means nothing falls
# back to /tmp halfway through a run.
export TMP="$SCRATCH"
export TEMP="$SCRATCH"

# Through `env`, so a caller may keep passing `VAR=value cmd` the way the
# scripts already did: `exec "$@"` would look for a program called `NEXT_DEV=1`.
exec env "$@"
