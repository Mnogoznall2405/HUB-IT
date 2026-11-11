const path = require('path');

// Only operational settings may enter diagnostics. Never project URLs or secrets.
const operationalKey = /^(APP_DB|CHAT_DB)_(POOL_SIZE|MAX_OVERFLOW|WRITE_POOL_SIZE|WRITE_MAX_OVERFLOW|READ_POOL_SIZE|READ_MAX_OVERFLOW|POOL_TIMEOUT|APPLICATION_NAME|READ_APPLICATION_NAME)$|^CHAT_REALTIME_(TRANSPORT|REQUIRED)$|^CHAT_PROCESS_COUNT$/;
function expectedApps(configPath = path.join(__dirname, 'ecosystem.all.config.js')) {
  return (require(configPath).apps || []).map(app => ({
    Name: app.name,
    // Launch signature (never the environment): lets the watchdog recognise leftovers of a dead PM2 daemon.
    Executable: String(app.script || ''),
    Arguments: Array.isArray(app.args) ? app.args.join(' ') : String(app.args || ''),
    Environment: Object.fromEntries(Object.entries(app.env || {}).filter(([key]) => operationalKey.test(key))),
  }));
}
if (require.main === module) process.stdout.write(JSON.stringify(expectedApps(process.argv[2])));
module.exports = { expectedApps, operationalKey };
