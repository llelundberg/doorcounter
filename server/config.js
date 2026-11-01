const path = require('path');

// The app root holds the pages (served by Apache) and data/.
const appDir = path.join(__dirname, '..');

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '127.0.0.1',
  appDir,
  dataDir: process.env.DATA_DIR || path.join(appDir, 'data'),
  // Serve the pages from Node for local development. In production Apache serves them.
  serveStatic: process.env.SERVE_STATIC === '1' || process.argv.includes('--static'),
};
