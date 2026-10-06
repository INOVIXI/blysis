/**
 * `prestart`: put live the build a module install finished, before
 * `next start` reads `.next`.
 *
 * A module install builds beside the live build and restarts the process to
 * serve it (src/core/lib/staged-build.ts). In the container the reconciler
 * does this on the way up; under systemd or pm2 the process comes back
 * through `npm start`, which is why it runs here too. It never builds - a
 * full reconciliation, which may, is scripts/reconcile-build.ts.
 */

import { settleStagedBuilds } from "../src/core/lib/staged-build";

settleStagedBuilds(process.cwd(), (msg) => console.log(`[prestart] ${msg}`));
