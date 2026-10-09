# Security

Report vulnerabilities privately through GitHub's **Report a vulnerability** feature when the repository maintainer has enabled it. Do not post live tokens, subscription URLs, passwords, database dumps or server logs containing secrets in public issues.

Test deployments on a separate server before enabling production traffic.

## Deployment boundaries

- The panel runs as `veloray`; the agent needs host privileges to write Xray configuration and restart its service. A compromised administrator or agent token can control that node's Xray configuration.
- Browser writes, including login, require a signed CSRF token and trusted origin. Session cookies are HttpOnly, SameSite Strict and secure in production.
- Passwords use Argon2id. Recovery codes and API tokens are hashed; node tokens, TOTP secrets and Telegram tokens are encrypted with AES-GCM.
- Subscription URLs are bearer credentials. Anyone possessing one can retrieve the client's connection details.
- Enabling mandatory 2FA restricts all management routes, including administrator APIs. API key owners must have enrolled 2FA; API keys themselves are noninteractive credentials and do not prompt for TOTP on each request.
- Preserve `VELORAY_FIELD_KEY`. Replacing it does not rotate existing encrypted secrets and makes them unreadable.
- Remote agents require HTTPS. Disabling TLS verification is an explicit per-node exception and should be replaced with a trusted certificate or CA bundle.
- The agent refuses remote plaintext listeners and supports optional client-certificate authentication.
- Configuration patches are privileged input. They can alter routing and listeners; they cannot disable the panel's local stats API or required counters.

Backups are not encrypted by the archive format. Their files and directory are private, but copy them only to access-controlled, encrypted storage. The manifest detects corruption; it is not a signature against an attacker who can rewrite the archive and manifest together.
