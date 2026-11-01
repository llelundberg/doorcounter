const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '127.0.0.1',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  publicDir: path.join(__dirname, 'public'),
  // Serve public/ from Node for local development. In production Apache serves it.
  serveStatic: process.env.SERVE_STATIC === '1' || process.argv.includes('--static'),
};
