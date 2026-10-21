/**
 * Imported first by the SSO tests: the mocked identity provider runs on 127.0.0.1, which the
 * SSRF policy only allows when listed (the configuration is read once, when the app is imported).
 */
process.env.OUTBOUND_ALLOWED_HOSTS = '127.0.0.1';
