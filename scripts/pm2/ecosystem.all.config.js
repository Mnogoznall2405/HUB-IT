const backend = require('./ecosystem.backend.config');
const inventory = require('./ecosystem.inventory.config');
const scan = require('./ecosystem.scan.config');
const bot = require('./ecosystem.bot.config');

module.exports = {
  apps: [
    ...(backend.apps || []),
    ...(inventory.apps || []),
    ...(scan.apps || []),
    ...(bot.apps || []),
  ],
};
