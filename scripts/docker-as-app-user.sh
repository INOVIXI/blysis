#!/bin/sh
# Runs the container's command as nextjs, after the one repair only root can make.
#
# Every dump is written to /app/backups, a volume. The image did not always
# create that directory, so Docker made the mount point itself, owned by
# root, and gave every volume it created that way the same owner. nextjs
# cannot write a backup into it and cannot take it back, and the image used to
# start as nextjs, so nothing could. The container now starts as root, hands
# that one directory to nextjs, and becomes nextjs before anything else runs:
# the server, the bootstrap and anything a module ships never run as root.
#
# The directory only, not what is under it. On the installs this repairs it
# is empty, because no backup could ever be written there, and on every other
# install it already belongs to nextjs.
#
# HOME is set because su-exec keeps the caller's, and npx writes its cache
# under HOME: /root is not somewhere nextjs may write.
set -e

if [ "$(id -u)" = "0" ]; then
    if [ -d /app/backups ]; then
        chown nextjs:nodejs /app/backups
    fi
    export HOME=/home/nextjs
    exec su-exec nextjs "$@"
fi

exec "$@"
