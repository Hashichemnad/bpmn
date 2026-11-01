/** Environment for e2e tests (loaded by global-setup and every test file). */
const url =
  process.env.TEST_DATABASE_URL ||
  'postgresql://processhub:devpassword@localhost:5432/processhub_test?schema=public';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: 'http://localhost:5173',
  RATE_LIMIT_MAX: '100000',
  LOGIN_RATE_LIMIT_MAX: '100000',
  USER_RATE_LIMIT_SCALE: '1000',
  LOGIN_MAX_ATTEMPTS: '3',
  LOGIN_LOCKOUT_MINUTES: '15',
  ENABLE_SWAGGER: 'false',
  // Fixed test-only key (32 bytes, base64).
  INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});

module.exports = { url };
