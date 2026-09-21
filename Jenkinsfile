/*
 * What every push to a branch, and every pull request, has to survive.
 *
 * The same three stages the GitHub workflow ran, in the same order and with
 * the same commands: the cheap gates and the build, the image with a module
 * installed into it and taken out again, and the end-to-end suite against a
 * production build. They live in `ci/stages.groovy` because the release
 * pipeline runs exactly these before it publishes anything.
 *
 * One build at a time. The stages publish ports and containers on a machine
 * that serves nine other projects, and two builds of the same branch would
 * fight over both.
 */
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        // Long enough for the smoke test, which restarts a container and
        // waits out a full `next build` inside it, twice.
        timeout(time: 90, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    environment {
        // A build needs these to exist, not to be right. The Prisma client is
        // constructed when a route module is loaded and Next loads every
        // route to collect its page data, so an absent DATABASE_URL fails the
        // build with an error about a connection string rather than a page.
        DATABASE_URL = 'postgresql://ci:ci@127.0.0.1:5432/ci'
        AUTH_SECRET = 'ci-build-secret-key-32-characters!'
        SECRET_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000'
        NEXT_TELEMETRY_DISABLED = '1'
        // Its own compose project, so the two pipelines never adopt
        // each other's containers.
        COMPOSE_PROJECT_NAME = 'blysis-ci'
    }

    stages {
        stage('Load the stages') {
            steps {
                script { ci = load 'ci/stages.groovy' }
            }
        }

        stage('Typecheck, lint and unit tests') {
            steps { script { ci.checks() } }
        }

        stage('Docker image and module lifecycle') {
            steps { script { ci.dockerSmoke(0) } }
            post { always { script { ci.dockerTeardown() } } }
        }

        stage('End to end') {
            steps { script { ci.e2e(env.BUILD_TAG, 0) } }
            post {
                always {
                    script { ci.e2eTeardown(env.BUILD_TAG, 0) }
                    archiveArtifacts artifacts: 'e2e-server.log,playwright-report/**,test-results/**',
                                     allowEmptyArchive: true
                }
            }
        }
    }

    post {
        always {
            // The workspace carries a node_modules, a production build and a
            // Playwright report. Thirty of those is the disk this box shares.
            cleanWs(deleteDirs: true, notFailBuild: true)
        }
    }
}
