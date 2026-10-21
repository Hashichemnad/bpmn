const { execSync } = require('node:child_process');
const path = require('node:path');
const { url } = require('./test-env');

/** Creates the e2e test database if needed and applies all migrations (tests truncate tables themselves). */
module.exports = async () => {
  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
};
