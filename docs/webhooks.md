# Signed Audit Webhooks (experimental)

VeloRay can queue administrative audit events and deliver signed HTTPS POST
requests to a subscriber. This is a **first-stage automation foundation**;
traffic, automatic expiry and node-state events will be added separately.

## Configure

As a superuser, visit **Settings → Webhooks**.

1. Enter a public HTTPS endpoint. Loopback, private networks and IP metadata
   endpoints are not allowed. Redirects are never followed.
2. Generate a random signing secret of at least 32 characters and save it.
   VeloRay encrypts it with `VELORAY_FIELD_KEY` and never returns the secret
   through the settings API.
3. Enable Webhooks and save. Select **Queue test event**.
4. Select **Queue status** to review pending, failed and delivered counts.
   Failed deliveries after eight attempts can be requeued with **Retry failed**.

Disable webhooks to stop new audit events from being enqueued and to pause
delivery of existing pending events. Purging queued records is a separate
administrator database operation.

## Payload

Each delivery contains a JSON object similar to:

```json
{
  "id": 123,
  "event": "clients.create",
  "target": "clients",
  "actor": "operator",
  "occurred_at": "2026-10-16T12:00:00Z"
}
```

`event` uses the existing audit action name. **The payload intentionally
does not include client passwords, subscription tokens, server settings,
credentials, or raw audit details.** Downstream consumers should query
authorized VeloRay API endpoints for any additional information.

Headers:

- `Content-Type: application/json`
- `X-VeloRay-Delivery: <delivery id>`
- `X-VeloRay-Timestamp: <unix epoch seconds>`
- `X-VeloRay-Signature: sha256=<lowercase hexadecimal HMAC>`

The HMAC-SHA256 key is the administrator-configured secret. The signed
message is `<timestamp> + "." + <exact raw JSON body bytes>`.

Always verify the HMAC in constant time, compare the timestamp to a short
acceptance window, and reject stale messages. Use `X-VeloRay-Delivery` as
an idempotency key: delivery is **at least once**, not exactly once.

## Delivery guarantees

Events are queued in PostgreSQL in the same transaction as the audit entry,
so rolled-back audited mutations do not produce notifications. A background
worker claims up to eight entries at a time, with DNS/public-IP checks,
a five-second HTTP timeout, and retries with exponential backoff. A delivery
counts as successful only for a 2xx HTTP response.

Delivery attempts stop after eight failures. Successful delivery records are
retained for seven days for dashboard counts. Network operations and automated
client or node transitions do not all generate audit events yet.

## API (superuser only)

- `GET /api/webhooks/status`: `pending`, `failed`, `delivered`
- `POST /api/webhooks/test`: queue an audit test event
- `POST /api/webhooks/retry`: schedule all exhausted deliveries for retry
- `PATCH /api/settings`: `webhook_enabled`, `webhook_url`,
  `webhook_signing_secret` (write-only) and
  `webhook_clear_secret` (write-only)

Check deployment logs for dispatch failures. Never configure the destination
to a private network service. Rotate signing secrets at both sender and
recipient together.

**Production readiness:** integration and security review are required before
deploying this experimental feature on a publicly reachable panel.
