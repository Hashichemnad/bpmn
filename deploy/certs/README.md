# Your own certificate (optional)

Only needed when Caddy should **not** request a certificate automatically (for example an intranet name
with a certificate from your company's certificate authority). Copy the certificate chain and the private
key here as `cert.pem` and `key.pem`, then set in `.env`:

    CADDY_TLS=/certs/cert.pem /certs/key.pem

The files are ignored by Git. See `docs/DEPLOYMENT.md`, section "Domain and HTTPS".
