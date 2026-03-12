const backend = require('./ecosystem.backend.config');
const scan = require('./ecosystem.scan.config');
const bot = require('./ecosystem.bot.config');

module.exports = {
  apps: [
    ...(backend.apps || []),
    ...(scan.apps || []),
    ...(bot.apps || []),
  ],
};
