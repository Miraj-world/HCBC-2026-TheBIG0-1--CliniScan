# Privacy-Minimal Product Analytics

## Purpose

CliniScan analytics answers product questions without collecting assessment content:

- How many anonymous sessions opened the website?
- How many sessions started and completed an assessment?
- How often are image, camera, and voice features used?
- How often does an assessment fail?
- Which broad processing-time bucket is most common?

This implementation is not a declaration that CliniScan is HIPAA compliant. HIPAA
applicability depends on the operator, relationships with covered entities or business
associates, data flows, contracts, and operational controls. Obtain qualified legal and
security review before making a compliance claim.

## Allowed Events

The backend accepts only these event names:

- `page_view`
- `assessment_started`
- `assessment_completed`
- `assessment_failed`
- `image_selected`
- `camera_opened`
- `voice_used`
- `report_downloaded`
- `report_shared`

Optional properties are restricted to:

- `image_used`: boolean
- `duration_bucket`: `under_10s`, `10_to_30s`, `30_to_90s`, or `over_90s`
- `error_category`: `network`, `service`, `validation`, or `unknown`

Pydantic rejects unknown fields. This prevents accidental additions such as symptom text
from being silently stored.

## Prohibited Data

Never add these fields to analytics events or analytics logs:

- symptom descriptions
- uploaded or camera images
- voice recordings or transcripts
- body location
- age
- known conditions
- medications
- urgency, possible conditions, clinical reasoning, or red flags
- complete `/analyze` or `/transcribe` request and response bodies
- names, email addresses, phone numbers, account identifiers, or precise location

## Anonymous Session Design

The React app creates a random UUID in `sessionStorage`. It lasts only for the current
browser-tab session. The backend combines that value with `ANALYTICS_HASH_SALT` and stores
only a SHA-256 hash. The raw UUID is never written to the analytics table.

This produces approximate session counts, not persistent identity or cross-device user
tracking. CliniScan does not use advertising cookies or browser fingerprinting.

## Storage

Events are stored in the existing PostgreSQL database table
`product_analytics_events`. The backend creates the table and timestamp index when the
first event arrives.

Recommended retention is 90 days or less. A scheduled database job should periodically
delete older rows:

```sql
DELETE FROM product_analytics_events
WHERE created_at < NOW() - INTERVAL '90 days';
```

## Endpoints

### Record an event

```http
POST /analytics/events
Content-Type: application/json
```

Example:

```json
{
  "event": "assessment_completed",
  "session_id": "random-per-tab-uuid",
  "image_used": true,
  "duration_bucket": "10_to_30s"
}
```

The endpoint returns `204` and never interrupts an assessment if analytics storage is
temporarily unavailable.

### Read aggregate counts

```http
GET /analytics/summary?days=30
X-Analytics-Token: your-private-admin-token
```

The response contains event totals and approximate unique-session totals. It does not
return raw event rows or session hashes. The endpoint returns `503` until
`ANALYTICS_ADMIN_TOKEN` is configured and `401` for an incorrect token.

Do not place the admin token in React code, a public URL, Git, documentation examples, or
browser storage. Use it only from a trusted local tool or future authenticated admin
surface.

## Operational Safeguards

- Keep analytics best-effort so failure never blocks the clinical workflow.
- Do not log analytics request bodies at the application layer.
- Keep Render, PostgreSQL, and access credentials restricted to authorized maintainers.
- Review host-level request logging because infrastructure logs may process IP addresses.
- Reassess consent, contracts, retention, and breach obligations before adding persistent
  identities, third-party scripts, advertising tools, or healthcare customers.
