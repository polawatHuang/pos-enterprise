'use strict';

/**
 * Alternative to the HTTP cron endpoint: run due jobs directly from a Plesk Scheduled Task
 * of type "Run a command", e.g.
 *   cd /var/www/vhosts/example.com/api && /opt/plesk/node/22/bin/node scripts/cron-tick.js
 */
const { runDue } = require('../src/jobs/runner');
const { scheduleRecurring } = require('../src/jobs/handlers');
const { pool } = require('../src/db/pool');

(async () => {
  try {
    await scheduleRecurring();
    const stats = await runDue();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...stats }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
