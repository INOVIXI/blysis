/*
 * The verification, written once and used by both pipelines.
 *
 * GitHub Actions had `workflow_call`, so the release workflow could call the
 * CI workflow and the checks existed in one place. Jenkins has no equivalent,
 * and the two ways round it are worse than this one: a shared library is a
 * second repository to keep in step for a single project, and having the
 * release job trigger the CI job verifies whatever that job's branch points
 * at rather than the commit being released.
 *
 * So both `Jenkinsfile` and `Jenkinsfile.release` load this out of the
 * checkout they are already building. The stages run against exactly the
 * commit in the workspace, and there is one copy of them.
 *
 * Ports are chosen, never defaulted. This box serves nine other projects: a
 * development server holds 3001, Postgres holds 5432 and Redis holds 6379,
 * so anything a pipeline publishes goes somewhere else or the bind fails and
 * the failure reads like the product.
 */

/**
 * The ports a build may publish on this machine without colliding.
 *
 * The offset separates the two pipelines from each other as well as from the
 * box. Pushing a tag onto a commit that is also on a branch starts both jobs,
 * Jenkins has two executors, and without this they would fight over the same
 * four ports and the same compose project - which reads as a product that
 * cannot start rather than as two builds in one place.
 */
def ports(int offset = 0) {
    return [
        smokeApp: 3031 + offset,
        e2eApp: 3041 + offset,
        e2ePostgres: 55432 + offset,
        e2eRedis: 56379 + offset,
    ]
}

/** The local tag this pipeline's image carries, before it is published. */
def localImage() {
    return env.COMPOSE_PROJECT_NAME ?: 'ci'
}

/**
 * Everything that needs no database: types, lint, the censuses, the unit
 * suite and the production build.
 *
 * `src/modules` is seeded from `module-sources` first. A fresh clone has it
 * empty - it is runtime install state and gitignored - and the generators
 * read it, so without this the registries are built for a product with no
 * modules and the tests measure that instead.
 */
def checks() {
    sh '''
        set -eu
        rm -rf src/modules
        cp -R module-sources src/modules
    '''
    // The postinstall hook runs the generators, and this stage runs them
    // itself a line later with the module tree in place. Skipping it keeps
    // `npm ci` to installing.
    withEnv(['SKIP_POSTINSTALL=1']) {
        sh 'npm ci'
    }
    sh '''
        set -eu
        npx tsx scripts/merge-schemas.ts
        npm run generate:themes
        npx tsx scripts/generate-registry.ts
        npx tsx scripts/generate-openapi.ts
    '''
    sh 'npx tsc --noEmit'
    sh 'npm run typecheck:modules'
    sh 'npx tsx scripts/validate-module.ts --all'
    sh 'npx tsx scripts/check-marketplace-sync.ts'
    sh 'npm run check:style'
    // `--max-warnings=0` rather than the script alone, which passes on a
    // warning. This is the thing that is supposed to refuse one.
    sh 'npm run lint -- --max-warnings=0'
    sh 'npm audit --audit-level=high'
    sh 'npm run test:coverage'
    sh 'npm run build'
}

/**
 * The image, and the module lifecycle inside it.
 *
 * A module is installed into a running container, the container is restarted
 * and expected to rebuild itself, and the module is expected to survive the
 * container being recreated. It is the only thing that exercises the volume
 * layout and the reconciler.
 */
def dockerSmoke(int offset = 0) {
    def port = ports(offset).smokeApp
    // Tagged for the pipeline that built it. Both pipelines build an image
    // from the same tree and one `blysis:ci` would be whichever finished
    // last, which is the wrong thing to then publish.
    def local = localImage()
    sh """
        set -eu
        cat > .env <<'ENVEOF'
BLYSIS_IMAGE=blysis
BLYSIS_VERSION=${local}
POSTGRES_PASSWORD=ci-smoke-postgres-password
AUTH_SECRET=ci-smoke-secret-key-32-characters!
SECRET_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENVEOF
        # Published on the loopback and away from 3001, which the development
        # server on this box already holds.
        echo 'APP_BIND_ADDR=127.0.0.1' >> .env
        echo 'APP_PORT=${port}' >> .env
        echo 'AUTH_URL=http://127.0.0.1:${port}' >> .env
        echo 'NEXTAUTH_URL=http://127.0.0.1:${port}' >> .env
    """
    sh "docker build -t blysis:${local} ."
    sh 'docker compose up -d'
    sh "APP_PORT=${port} ci/wait-for-health.sh 180"

    sh """
        set -eu
        code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/api/v1/blog/articles)
        echo "pre-install status: \$code"
        test "\$code" = "404"
    """
    sh '''
        set -eu
        docker compose exec -T app cp -R module-sources/blog src/modules/blog
        docker compose exec -T app npx tsx scripts/merge-schemas.ts
        docker compose exec -T app npx tsx scripts/generate-registry.ts
    '''
    sh "docker compose restart app && APP_PORT=${port} ci/wait-for-health.sh 900"
    sh """
        set -eu
        code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/api/v1/blog/articles)
        echo "post-install status: \$code"
        test "\$code" = "200"
    """
    // Written to a file rather than piped: `grep -q` exits as soon as it
    // matches and the writer then dies on SIGPIPE, which `set -o pipefail`
    // reports as a failure of the thing that worked.
    sh '''
        set -eu
        docker compose exec -T app npx tsx scripts/reconcile-build.ts > reconcile.txt 2>&1
        cat reconcile.txt
        grep -q "no rebuild" reconcile.txt
    '''
    sh "docker compose down && docker compose up -d && APP_PORT=${port} ci/wait-for-health.sh 900"
    sh """
        set -eu
        code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/api/v1/blog/articles)
        echo "after recreation: \$code"
        test "\$code" = "200"
    """
}

/** Whatever the smoke test left running, whether it passed or not. */
def dockerTeardown() {
    sh 'docker compose logs --tail=200 || true'
    sh 'docker compose down -v || true'
}

/**
 * The end-to-end suite, against a production build.
 *
 * Redis is not optional. With `NODE_ENV=production` and no `REDIS_URL` the
 * rate limiter fails closed and answers every request with 429, so the server
 * never reports healthy and the suite cannot start.
 */
def e2e(String tag, int offset = 0) {
    def p = ports(offset)
    def pg = "blysis-ci-pg-${tag}"
    def rd = "blysis-ci-redis-${tag}"

    sh """
        set -eu
        docker run -d --name ${pg} \
            -e POSTGRES_USER=blysis -e POSTGRES_PASSWORD=blysis -e POSTGRES_DB=blysis_e2e \
            -p 127.0.0.1:${p.e2ePostgres}:5432 postgres:17-alpine
        docker run -d --name ${rd} -p 127.0.0.1:${p.e2eRedis}:6379 redis:8-alpine
        for _ in \$(seq 1 60); do
            docker exec ${pg} pg_isready -U blysis >/dev/null 2>&1 && break
            sleep 1
        done
    """

    withEnv([
        "DATABASE_URL=postgresql://blysis:blysis@127.0.0.1:${p.e2ePostgres}/blysis_e2e",
        "REDIS_URL=redis://127.0.0.1:${p.e2eRedis}",
        "AUTH_SECRET=ci-e2e-secret-key-32-characters!!",
        "SECRET_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000",
        "AUTH_URL=http://127.0.0.1:${p.e2eApp}",
        "E2E_BASE_URL=http://127.0.0.1:${p.e2eApp}",
        "SEED_ADMIN_EMAIL=admin@blysis.com",
        "SEED_ADMIN_PASSWORD=e2e-admin-password",
        "E2E_ADMIN_EMAIL=admin@blysis.com",
        "E2E_ADMIN_PASSWORD=e2e-admin-password",
        "NEXT_TELEMETRY_DISABLED=1",
    ]) {
        sh '''
            set -eu
            rm -rf src/modules
            cp -R module-sources src/modules
        '''
        withEnv(['SKIP_POSTINSTALL=1']) { sh 'npm ci' }
        sh '''
            set -eu
            npx tsx scripts/merge-schemas.ts
            npm run generate:themes
            npx tsx scripts/generate-registry.ts
            npx tsx scripts/generate-openapi.ts
        '''
        sh '''
            set -eu
            npx prisma db push --accept-data-loss
            npx tsx prisma/seed.ts
            # --register-modules because this seeds src/modules from the
            # sources rather than installing them. Without the ModuleConfig
            # row the app filters every module string out and the specs drive
            # a site rendering raw keys.
            npx tsx scripts/seed-translations.ts --register-modules
        '''
        sh 'npm run build'
        // Without `--with-deps`, which wants root. The system libraries are
        // already present on this box; only the browser is downloaded, once,
        // into the Jenkins user's cache.
        sh 'npx playwright install chromium'
        sh """
            set -eu
            npx next start --port ${p.e2eApp} --hostname 127.0.0.1 > e2e-server.log 2>&1 &
            for _ in \$(seq 1 60); do
                curl -fsS http://127.0.0.1:${p.e2eApp}/api/health >/dev/null 2>&1 && exit 0
                sleep 1
            done
            echo "server did not become healthy within 60s; last 50 log lines:"
            tail -50 e2e-server.log || true
            exit 1
        """
        sh 'npm run test:e2e'
    }
}

/**
 * The sidecars and the server this build started, however it ended.
 *
 * The server is found by the port it holds, not by a pattern and not by the
 * pid the shell recorded. Nine other projects run here and `pkill -f` has
 * taken seven of them down at once before; and `$!` after `npx next start`
 * is the wrapper's pid, so killing it leaves the server holding the port and
 * every later build measuring a stale one.
 */
def e2eTeardown(String tag, int offset = 0) {
    sh """
        set +e
        pid=\$(ss -ltnp 2>/dev/null | grep ':${ports(offset).e2eApp}\\b' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | head -1)
        if [ -n "\$pid" ]; then echo "stopping the e2e server, pid \$pid"; kill "\$pid"; fi
        docker rm -f blysis-ci-pg-${tag} blysis-ci-redis-${tag} || true
    """
}

return this
