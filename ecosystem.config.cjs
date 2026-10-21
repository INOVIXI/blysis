// PM2 configuration for a manual (non-Docker) deployment.
//
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup
//
// The Docker install does not use this file; docker-compose.yml supervises the
// container with `restart: unless-stopped`.
const fs = require('fs');
const path = require('path');

// Load .env file
const envFile = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf-8').split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) return;
        let key = line.slice(0, eqIdx);
        let val = line.slice(eqIdx + 1);
        // Strip quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        env[key] = val;
    });
}

module.exports = {
    apps: [{
        name: 'blysis',
        // `npm start`, never `next start`: its prestart is what puts the build
        // a module install staged live. The flags after `--` reach next start.
        script: 'npm',
        args: 'start -- -p 3001 -H 0.0.0.0',
        cwd: __dirname,
        env: env,

        // One process, deliberately. Module pages are compiled into the app,
        // so a module install rebuilds and replaces the process; two workers
        // would compile into the same .next and the loser would serve a
        // half-written build.
        instances: 1,
        exec_mode: 'fork',

        // Required, not cosmetic. After a module install the app exits on
        // purpose so the new build is served; autorestart is what completes
        // the install.
        autorestart: true,

        // Longer than SHUTDOWN_GRACE_MS (default 10s) so the shutdown registry
        // finishes draining Prisma and the scheduler before PM2 sends SIGKILL.
        kill_timeout: 15000,
    }]
};
