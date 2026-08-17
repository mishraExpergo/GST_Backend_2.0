# GST Backend 2.0 — Complete API & System Documentation

This document describes the NestJS backend at `GST_Backend_2.0/backend`: what it does, how data flows, every HTTP API, and the aggregation scheduler.

Use it as the single source of truth for onboarding and API integration.

---

## Terminology: Coapplicant (not Considered / Secondary)

In product language and **API responses**, the former "considered entity" / "secondary" concept is now **coapplicant**:

| Legacy | Current (API / metrics) |
|--------|-------------------------|
| considered entity | coapplicant entity |
| `consideredEntities` | `coapplicantEntities` |
| `CONSIDERED_*` metric keys | `COAPPLICANT_*` metric keys |
| `CONSIDERED_ENTITY` | `COAPPLICANT_ENTITY` |
| `type=secondary` on aggregation | `type=coapplicant` (`secondary` still accepted) |
| `considered_state` / `considered_consent_available` / any `*considered*` | Remapped automatically in **all** `/gst/*` HTTP responses via `CoapplicantTerminologyInterceptor` (keys + string values). DB column names stay unchanged. |

**Not renamed yet (DB stays as-is):** Postgres tables `secondary_gst_aggregation` / `secondary_gst_aggregation_history`, and upload columns `considered_entity_pan` / `considered_entity_gst_no`. The API remaps these after fetch.

---

## 1. What this application does (big picture)

1. **Upload** a customer / loan Excel (or CSV) into Postgres (`gst_uploaded_file_data` by default).
2. **Fetch GST data** from Sandbox:
   - Public APIs (no OTP): GSTIN verify, GSTR track (return filing by financial year), PAN search.
   - Taxpayer APIs (OTP): GSTR-2B and GSTR-3B (monthly; year APIs loop months).
3. **Store** raw API results in **MongoDB**.
4. **Aggregate** metrics into **Postgres** tables for the dashboard.
5. Optionally **queue** heavy jobs via RabbitMQ, or run them **inline**.
6. Log external GST calls in `api_request_logs`, and (optional) internal DB statements in `db_query_logs`.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Frontend   │────▶│  NestJS API  │────▶│ Sandbox GST API │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         PostgreSQL     MongoDB      RabbitMQ
         (upload,       (raw GST     (optional
          jobs,          docs)        queues)
          aggregation,
          logs)
```

---

## 2. Base URL, auth, and response styles

| Item | Detail |
|------|--------|
| Default local URL | `http://localhost:3000` |
| Controllers | `/auth/*`, `/gst/*` |
| JWT | When `JWT_AUTH_ENABLED=true` (default), all routes need `Authorization: Bearer <token>` except `@Public()` routes. Set `JWT_AUTH_ENABLED=false` for local testing without tokens. |
| Public routes | `POST /auth/login`, `POST /gst/compliance/public/pan/search`, `GET /gst/compliance/public/pan/search` |

### Success envelope (used by many taxpayer / PAN / scheduler endpoints)

```json
{
  "success": true,
  "flow": "taxpayer-returns.gstr-2b",
  "requestId": "uuid",
  "timestamp": "2026-08-05T06:30:00.000Z",
  "data": { }
}
```

Other endpoints return plain JSON objects (documented per API).

### Async job pattern

Upload and batch verify endpoints return **202** with a `jobId`. Poll:

`GET /gst/status/:jobId`

---

## 3. Data stores (where things live)

### 3.1 MongoDB collections (`ENABLE_MONGO=true`)

| Collection | Written by | Uniqueness / meaning |
|------------|------------|----------------------|
| `gst_compliance_data` | `POST /gst/verify-and-fetch` | One doc per `loanId + gstin` — GSTIN profile / public search |
| `gst_2b_compliance_data` | GSTR-2B batch + OTP year API | One doc per `loanId + gstin + year + month` |
| `gst_3b_compliance_data` | GSTR-3B batch + OTP year API | One doc per `loanId + gstin + year + month` |
| `gst_gstR1_returns_compliance_data` | GSTR track batch/single | One doc per `loanId + gstin + financialYear` |
| `gst_pan_search_data` | PAN search APIs | Search results keyed by loan/customer/searchKey |

### 3.2 Important Postgres tables

| Table | Purpose |
|-------|---------|
| `gst_uploaded_file_data` (or custom upload table) | Portfolio rows from Excel (customer, loan, GSTIN, PAN, username, status) |
| `jobs` / `job_tasks` | Async job progress |
| `primary_gst_aggregation` / `secondary_gst_aggregation` | Dashboard aggregation metrics |
| `primary_gst_aggregation_history` / `secondary_gst_aggregation_history` | History of aggregation changes |
| `api_request_logs` | External Sandbox / taxpayer API call audit (dashboard operational status) |
| `db_query_logs` | Internal Postgres + Mongo query audit (when `ENABLE_DB_QUERY_LOGS=true`) |
| `taxpayer_auth_sessions` | OTP / taxpayer session state |
| `users` | Login users |

---

## 4. Yearly vs monthly vs financial-year fetch (critical)

| Data type | How period works | OTP? |
|-----------|------------------|------|
| **GSTIN verify** | Once per GSTIN (no month/year on the job) | No |
| **GSTR track (GSTR-1 filing track)** | **Financial year** per GSTIN (e.g. `FY 2021-22`) | No |
| **GSTR-2B / GSTR-3B batch job** | **One calendar month** for all GSTINs in the upload (`year` + `month` in body) | Yes |
| **GSTR-2B / GSTR-3B year GET** | Caller passes a **year**; backend loops **required months** and fetches missing ones | Yes |
| **Notices** | By date (`DD/MM/YYYY`, last 60 days) | Yes |

### Month loop rules (OTP year APIs)

For `GET /gst/taxpayer/gstr-2b/:year` and `gstr-3b/:year`:

- Past years → months `1..12`
- Current year → months `1..currentMonth`
- Future year → no months
- Months already present in Mongo are served from cache; only missing months hit Sandbox

---

## 5. External Sandbox APIs — what kind of data is fetched

All external calls go to `GST_API_BASE_URL` (Sandbox). There are two auth styles:

| Style | Auth | Used for |
|-------|------|----------|
| **Platform token** | App `api-key` / `api-secret` → access token (`GstAuthService`) | GSTIN verify/search, GSTR track (R1), PAN search |
| **Taxpayer session** | OTP generate → submit → verify → taxpayer access token | GSTR-2B, GSTR-3B, notices |

### 5.1 Quick map

| Business name | Sandbox path (approx.) | Period | OTP? | What you get (plain language) | Stored in |
|---------------|------------------------|--------|------|-------------------------------|-----------|
| GSTIN verify | `POST /gst/compliance/public/gstin/verify` | Once | No | Is GSTIN valid? Legal name, PAN, status, state, registration date | `gst_compliance_data.verifyResponse` |
| GSTIN search | `POST /gst/compliance/public/gstin/search` | Once | No | Fuller GSTIN / taxpayer profile (addresses, business details, e-invoice flags, etc. as returned by Sandbox) | `gst_compliance_data.searchResponse` |
| GSTR-1 track (R1) | `POST /gst/compliance/public/gstrs/track?gstr=gstr-1&financial_year=FY YYYY-YY` | Financial year | No | Filing **track** for returns in that FY: which periods were filed / not filed / delayed (not full invoice-level GSTR-1 JSON) | `gst_gstR1_returns_compliance_data` |
| PAN search | `POST /gst/compliance/public/pan/search?state_code=` | N/A | No | All GSTINs linked to a PAN (optionally one state, or many states in parallel) | `gst_pan_search_data` |
| GSTR-2B | `GET /gst/compliance/tax-payer/gstrs/gstr-2b/{year}/{month}` | Calendar month | Yes | Auto-drafted **inward** supplies for that month: supplier invoices, ITC eligibility / ineligible / reversed, IGST/CGST/SGST/CESS | `gst_2b_compliance_data` |
| GSTR-3B | `GET /gst/compliance/tax-payer/gstrs/gstr-3b/{year}/{month}` | Calendar month | Yes | Monthly **summary return**: taxable / exempt turnover, reverse charge, purchases, ITC available / reversed / utilised, cash tax paid | `gst_3b_compliance_data` |
| Notices list | `GET /gst/compliance/tax-payer/notices` | By date | Yes | List of GST notices for the taxpayer around that date | (response; logged via api_request_logs) |
| Notice detail | `GET /gst/compliance/tax-payer/notices/{referenceId}` | By id | Yes | Full text / details of one notice | (response; logged) |
| OTP / session | `/gst/compliance/tax-payer/otp`, `.../otp/verify`, `.../session/refresh` | N/A | — | Auth only (session tokens), not return data | `taxpayer_auth_sessions` |

### 5.2 GSTIN verify + search (public)

**Purpose:** Know whether a GSTIN is valid and get the basic / detailed taxpayer profile.

Typical fields used downstream:

- Legal / trade name, GSTIN status (Active / Cancelled / Suspended, etc.)
- PAN, state code / state name
- Registration start date, nature of business (when present)
- Address / e-invoice related flags from the **search** payload (used for compliance aggregation counts)

**Not** monthly return data — profile only.

### 5.3 GSTR-1 via public track API (called “gstr-track” in this app)

**Purpose:** Filing compliance for GSTR-1 over a **financial year**.

Sandbox is called with `gstr=gstr-1` and `financial_year=FY 2021-22` (example).

What comes back (and what we use):

- Legal name (`lgnm`) when present
- Per-period filing rows for that FY: return period / month, filed vs not filed, delay vs due date
- Aggregated into metrics like total return periods, filed / non-filed / delayed / on-time counts

**Important:** This is a **track / filing-status** feed for GSTR-1, **not** the full GSTR-1 invoice export (B2B line items, HSN, etc.).

### 5.4 GSTR-2B (taxpayer, monthly)

**Purpose:** What suppliers reported **against this GSTIN** for a given month (inward supplies / ITC view).

Typical content in the Sandbox payload:

- Supplier GSTINs and invoices for the month
- Tax breakup: IGST, CGST, SGST, CESS
- ITC classification: eligible / ineligible / reversed

Used for aggregation metrics such as:

- Supplier count, invoice counts
- Eligible / ineligible / reversed ITC totals
- IGST / CGST / SGST / CESS ITC amounts

### 5.5 GSTR-3B (taxpayer, monthly)

**Purpose:** The taxpayer’s **monthly summary return** (liability and ITC utilisation snapshot).

Typical content used from the payload:

- Outward / taxable turnover, exempt turnover, reverse-charge sales
- Purchase-side values (inter / intra / non-GST where present)
- ITC available, reversed, ineligible, utilised (and CGST/SGST/IGST splits)
- Cash tax paid (CGST/SGST/IGST)

### 5.6 PAN search (public)

**Purpose:** Discover GSTINs registered under a PAN (primary or coapplicant).

- Optional `state_code` → one state
- No state → fan-out across state codes `01..38` (some codes skipped)

Each hit can include GSTIN, legal/trade name, status — used to mark listed vs unlisted GSTINs vs the upload file.

### 5.7 Notices (taxpayer)

**Purpose:** Compliance / department notices for the authenticated taxpayer (list + detail by `referenceId`). Not used for turnovers/ITC aggregation.

### 5.8 How this maps to our Nest routes

| Our API | Sandbox data pulled |
|---------|---------------------|
| `POST /gst/verify-and-fetch` | GSTIN verify + search |
| `POST /gst/verify-and-fetch/gstr-track` (+ `/single`) | GSTR-1 track for a FY |
| `POST /gst/verify-and-fetch/gstr-2b` | GSTR-2B for one `year`+`month` (all upload GSTINs) |
| `POST /gst/verify-and-fetch/gstr-3b` | GSTR-3B for one `year`+`month` |
| `GET /gst/taxpayer/gstr-2b/:year` | GSTR-2B months in that year (cache + missing months) |
| `GET /gst/taxpayer/gstr-3b/:year` | GSTR-3B months in that year |
| `POST/GET .../pan/search` | PAN → GSTIN list |
| `GET /gst/taxpayer/notices` (+ `/:referenceId`) | Notices |

---

## 6. End-to-end business flows

### 6.1 Excel upload → portfolio table

1. `POST /gst/upload` with file + `tableName`
2. Job type `EXCEL` created
3. If RabbitMQ on → queue `excel_import`; else process inline
4. Rows land in Postgres table; poll `GET /gst/status/:jobId`

### 6.2 GSTIN profile fetch (no OTP)

1. `POST /gst/verify-and-fetch`
2. Job reads all GSTINs from upload table
3. Public Sandbox verify/search → Mongo `gst_compliance_data`
4. Updates row status / last pull date
5. Runs aggregation → primary/coapplicant aggregation Postgres tables

### 6.3 GSTR track / return filing (no OTP, by FY)

1. Batch: `POST /gst/verify-and-fetch/gstr-track` with `financialYear`
2. Or single sync: `POST /gst/verify-and-fetch/gstr-track/single`
3. Stores in `gst_gstR1_returns_compliance_data`
4. Runs track aggregation

### 6.4 GSTR-2B / 3B (OTP)

**Option A — batch for one month (all GSTINs in upload):**

1. OTP per GSTIN: generate → submit → verify (session stored)
2. `POST /gst/verify-and-fetch/gstr-2b` or `.../gstr-3b` with `year`, `month`
3. Writes Mongo monthly docs; may trigger aggregation

**Option B — one GSTIN for a whole year:**

1. OTP as above
2. `GET /gst/taxpayer/gstr-2b/:year?gstin=&customerId=&associatedLoanId=`
3. Loops months, caches existing, fetches missing

### 6.5 Scheduler aggregation

Background (or manual) check: for each loan, if every expected GSTIN has **at least one** 2B/3B Mongo doc, run customer aggregation into Postgres. This does **not** require a full 12 months of coverage — “any stored return for that GSTIN” is enough for completeness.

---

## 7. Auth APIs (`/auth`)

### `POST /auth/login` — Public

**Request body**

```json
{
  "username": "admin",
  "password": "Admin@123"
}
```

**Response**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": "1d",
  "user": { "id": "...", "username": "admin" }
}
```

Bootstrap credentials come from `AUTH_BOOTSTRAP_USERNAME` / `AUTH_BOOTSTRAP_PASSWORD` if no users exist.

### `GET /auth/me`

**Headers:** `Authorization: Bearer <token>` (when JWT enabled)

**Response:** `{ "userId": "...", "username": "..." }`

---

## 8. GST APIs — Dashboard / read

### `GET /gst/dashboard/revenue-graph`

Dashboard revenue chart from Mongo **GSTR-3B** (`gst_3b_compliance_data`).

| Query | Required | Notes |
|-------|----------|--------|
| `loanId` | one of loanId / pan | Mutually exclusive with `pan` |
| `pan` | one of loanId / pan | Mutually exclusive with `loanId` |

**No** `range` / `bucket` params — response includes **all** series:

| Range | Financial-year window (ref = today) | Buckets |
|-------|-------------------------------------|---------|
| `1y` | Current Indian FY (Apr–Mar), e.g. Aug 2026 → Apr 2026–Mar 2027 | `monthly`, `quarterly`, `halfYearly` |
| `3y` | Current FY + 2 prior FYs | `quarterly`, `halfYearly`, `yearly` |
| `5y` | Current FY + 4 prior FYs | `quarterly`, `halfYearly`, `yearly` |

**Revenue:** taxable turnover extracted from each 3B doc (same logic as aggregation). Same calendar month across multiple GSTINs is **summed**. Missing periods are **0**.

Each point also includes `percentageChange` vs the **previous point in the same series**:

`((currentRevenue - previousRevenue) / previousRevenue) * 100` (rounded to 2 decimals).  
`null` for the first point, or when previous revenue is `0` (avoids divide-by-zero).

Each point also includes **`gstWise`**: GSTIN-level taxable turnover for that bar (for click detail), sorted by revenue desc, with `sharePercent` of the bar total. Empty periods have `gstWise: []`.

**Response:** success envelope `flow: "dashboard.revenue-graph"`, `data.ranges["1y"|"3y"|"5y"]` with `financialYears`, `from`, `to`, `totalRevenue`, and bucket objects `{ totalRevenue, points[] }` where each point has `key`, `label`, `from`, `to`, `revenue`, `percentageChange`, `gstWise[]`.

**Example**

```bash
curl "http://localhost:3000/gst/dashboard/revenue-graph?loanId=LN000002"
curl "http://localhost:3000/gst/dashboard/revenue-graph?pan=AAACP0252G"
```

**Sample response (abridged)** — on bar click, use that point’s `gstWise`:

```json
{
  "success": true,
  "flow": "dashboard.revenue-graph",
  "data": {
    "loanId": "LN000002",
    "pan": null,
    "revenueField": "taxableTurnover",
    "currency": "INR",
    "asOf": "2026-08-13",
    "currentFinancialYear": "FY 2026-27",
    "ranges": {
      "1y": {
        "financialYears": ["FY 2026-27"],
        "from": "2026-04-01",
        "to": "2027-03-31",
        "totalRevenue": 1500000,
        "monthly": {
          "totalRevenue": 1500000,
          "points": [
            {
              "key": "2026-04",
              "label": "Apr 2026",
              "from": "2026-04-01",
              "to": "2026-04-30",
              "revenue": 1000000,
              "percentageChange": null,
              "gstWise": [
                {
                  "gstin": "09AAACP0252G2ZQ",
                  "revenue": 600000,
                  "sharePercent": 60,
                  "legalName": "Primary Pvt Ltd",
                  "entityType": "PRIMARY",
                  "pan": "AAACP0252G"
                },
                {
                  "gstin": "27BBBCP0252G1Z5",
                  "revenue": 400000,
                  "sharePercent": 40,
                  "legalName": "Coapplicant Co",
                  "entityType": "COAPPLICANT_ENTITY",
                  "pan": "BBBCP0252G"
                }
              ]
            },
            {
              "key": "2026-05",
              "label": "May 2026",
              "from": "2026-05-01",
              "to": "2026-05-31",
              "revenue": 500000,
              "percentageChange": -50,
              "gstWise": [
                {
                  "gstin": "09AAACP0252G2ZQ",
                  "revenue": 500000,
                  "sharePercent": 100,
                  "legalName": "Primary Pvt Ltd",
                  "entityType": "PRIMARY",
                  "pan": "AAACP0252G"
                }
              ]
            }
          ]
        },
        "quarterly": {
          "totalRevenue": 1500000,
          "points": [
            {
              "key": "FY2026-27-Q1",
              "label": "Q1 FY 2026-27",
              "from": "2026-04-01",
              "to": "2026-06-30",
              "revenue": 1500000,
              "percentageChange": null,
              "gstWise": [
                {
                  "gstin": "09AAACP0252G2ZQ",
                  "revenue": 1100000,
                  "sharePercent": 73.33,
                  "legalName": "Primary Pvt Ltd",
                  "entityType": "PRIMARY",
                  "pan": "AAACP0252G"
                },
                {
                  "gstin": "27BBBCP0252G1Z5",
                  "revenue": 400000,
                  "sharePercent": 26.67,
                  "legalName": "Coapplicant Co",
                  "entityType": "COAPPLICANT_ENTITY",
                  "pan": "BBBCP0252G"
                }
              ]
            }
          ]
        },
        "halfYearly": { "totalRevenue": 1500000, "points": ["… H1/H2 with gstWise …"] }
      },
      "3y": {
        "financialYears": ["FY 2024-25", "FY 2025-26", "FY 2026-27"],
        "from": "2024-04-01",
        "to": "2027-03-31",
        "totalRevenue": 4500000,
        "quarterly": { "totalRevenue": 4500000, "points": ["… each Q with gstWise …"] },
        "halfYearly": { "totalRevenue": 4500000, "points": ["…"] },
        "yearly": {
          "totalRevenue": 4500000,
          "points": [
            {
              "key": "FY2026-27",
              "label": "FY 2026-27",
              "from": "2026-04-01",
              "to": "2027-03-31",
              "revenue": 1500000,
              "percentageChange": 0,
              "gstWise": [
                {
                  "gstin": "09AAACP0252G2ZQ",
                  "revenue": 1100000,
                  "sharePercent": 73.33,
                  "legalName": "Primary Pvt Ltd",
                  "entityType": "PRIMARY",
                  "pan": "AAACP0252G"
                },
                {
                  "gstin": "27BBBCP0252G1Z5",
                  "revenue": 400000,
                  "sharePercent": 26.67,
                  "legalName": "Coapplicant Co",
                  "entityType": "COAPPLICANT_ENTITY",
                  "pan": "BBBCP0252G"
                }
              ]
            }
          ]
        }
      },
      "5y": {
        "financialYears": ["FY 2022-23", "FY 2023-24", "FY 2024-25", "FY 2025-26", "FY 2026-27"],
        "from": "2022-04-01",
        "to": "2027-03-31",
        "totalRevenue": 7500000,
        "quarterly": { "totalRevenue": 7500000, "points": ["…"] },
        "halfYearly": { "totalRevenue": 7500000, "points": ["…"] },
        "yearly": { "totalRevenue": 7500000, "points": ["… each FY with gstWise …"] }
      }
    }
  }
}
```

---

### `GET /gst/data`

Portfolio / uploaded rows for the frontend table.

| Query | Default | Notes |
|-------|---------|--------|
| `tableName` | `gst_uploaded_file_data` | Postgres table |
| `page` | `1` | |
| `limit` | `50` | Max 500 |

**Example**

```bash
curl "http://localhost:3000/gst/data?page=1&limit=50"
```

**Response shape:** `{ table, total, page, limit, data: [ ...rows ] }`

---

### `GET /gst/compliance/public`

Mongo GSTIN compliance for one loan (includes linked GSTR-1 track history lookup).

| Query | Required |
|-------|----------|
| `loanId` | Yes |

**Response:** `{ loanId, count, data: [ ...mongoDocs ] }`

---

### `POST /gst/compliance/public/batch` → 200

Batch variant of public compliance.

**Body**

```json
{
  "requests": [
    { "loanId": "LN000002", "pan": "AAACP0252G", "page": 1, "limit": 50 }
  ]
}
```

Max ~1000 valid loanIds. **Response:** `{ items: [{ params, response }] }`

---

### `POST /gst/compliance/public/pan/search` — Public → 200

Calls Sandbox PAN search and stores results.

| Query | Notes |
|-------|--------|
| `state_code` | Optional |

**Body:** `{ "pan": "AAACP0252G" }`

**Response:** success envelope, `flow: "compliance.public.pan-search"`, `data` with `pan`, `count`, `items[]` (listed/unlisted GSTINs + stored ids).

**Mongo:** `gst_pan_search_data`

---

### `GET /gst/compliance/public/pan/search` — Public

Read stored PAN search results.

| Query | Required |
|-------|----------|
| `pan` | Yes |
| `state_code` | Optional (omit = all search keys) |

**Response:** success envelope, `flow: "compliance.public.pan-search.get"`

---

### `GET /gst/compliance/gstr-2b-3b`

Read stored monthly 2B/3B docs from Mongo for a customer.

| Query | Required | Example |
|-------|----------|---------|
| `customerId` | Yes | |
| `years` | Yes | `2024,2025` |
| `months` | Yes | `1,2,3` |

**Response:** `{ "GST2B": [...], "GST3B": [...] }`

---

### `GET /gst/customer-gstr-status-counts`

Per-customer counts of updated / pending / failed across GSTREG1, GSTR1, GSTR2B, GSTR3B (upload units vs latest `api_request_logs`).

**Response:** map of `customerId → { GSTREG1, GSTR1, GSTR2B, GSTR3B: { updated, pending, failed } }`

---

### `GET /gst/api-request-logs`

External API logs for Operational Status UI.

| Query | Notes |
|-------|--------|
| `loanId` and/or `gstin` | At least one required (OR match) |

**Response:** `{ loanId, gstin, count, lastUpdatedAt, data: [...] }`

---

### `POST /gst/api-request-logs/batch` → 200

**Body:** `{ "requests": [{ "loanId": "LN1" }, { "gstin": "09..." }] }`  
**Response:** `{ items: [{ params, response }] }`

---

### `GET /gst/db-query-logs`

Internal DB audit (only written when `ENABLE_DB_QUERY_LOGS=true`).

| Query | Notes |
|-------|--------|
| `requestId`, `jobId`, `gstin` | Optional filters |
| `dbEngine` | `postgres` or `mongo` |
| `from`, `to` | ISO dates |
| `limit`, `offset` | Default 50 / 0 |

**Response:** `{ enabled, total, limit, offset, items }`  
Also returns header `x-request-id` on normal HTTP calls when logging is on.

---

### `GET /gst/aggregation`

Dashboard aggregation metrics for a loan.

| Query | Notes |
|-------|--------|
| `loanId` | Required |
| `type` | `primary` (default) or `secondary` |

**Reads:** `primary_gst_aggregation` or `secondary_gst_aggregation`

**Response:** `{ loanId, count, data: [{ outputField, output }], debug }`

**Example**

```bash
curl "http://localhost:3000/gst/aggregation?loanId=LN000002&type=primary"
```

---

### `GET /gst/api-logs`

Filtered browse of `api_request_logs` (taxpayer / return logging UI).

| Query | Notes |
|-------|--------|
| `gstrType` | e.g. `GSTR-2B`, `GSTR-3B`, `GST-RETURN`, `GST-NOTICES`, … |
| `status` | `PENDING` \| `SUCCESS` \| `FAILED` |
| `customerId`, `associatedLoanId`, `gstNumber`, `dataSource`, `apiName` | Optional |
| `fromDate`, `toDate` | Optional |
| `limit`, `offset` | limit 1–200, default 50 |

**Response:** success envelope, `flow: "taxpayer-returns.api-logs"`, `data: { items, total, limit, offset }`

---

### `GET /gst/status/:jobId`

**Response:**

```json
{
  "id": "uuid",
  "type": "EXCEL | API",
  "status": "PENDING | PROCESSING | COMPLETED | FAILED",
  "totalChunks": 0,
  "completedChunks": 0,
  "progressPercentage": 0,
  "errorMessage": null,
  "metadata": {},
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## 9. GST APIs — Upload & verify jobs

### `POST /gst/upload` → 202

**Content-Type:** `multipart/form-data`

| Field | Required | Notes |
|-------|----------|--------|
| `file` | Yes | `.xlsx` / `.xls` / `.csv`, ≤ 25 MB |
| `tableName` | Yes | Target Postgres table name |

**Response:**

```json
{
  "message": "...",
  "jobId": "uuid",
  "status": "PENDING",
  "checkStatusUrl": "/gst/status/<jobId>"
}
```

**Queue:** RabbitMQ `excel_import` if `ENABLE_RABBITMQ=true`, else inline.

---

### `POST /gst/verify-and-fetch` → 202

Public GSTIN verify for all rows in the upload table. **No OTP. Not month-based.**

**Body**

```json
{ "tableName": "gst_uploaded_file_data" }
```

(`tableName` optional; defaults to upload table.)

**Job metadata:** `{ "operation": "GSTIN_VERIFY_AND_FETCH", "sourceTable": "..." }`

**Writes:** Mongo `gst_compliance_data` → then aggregation tables.

---

### `POST /gst/verify-and-fetch/gstr-2b` → 202

**Monthly** GSTR-2B for every GSTIN in the upload. **OTP session required** per GSTIN.

**Body**

```json
{
  "year": 2024,
  "month": 3,
  "tableName": "gst_uploaded_file_data",
  "username": "optional-override"
}
```

| Field | Rules |
|-------|--------|
| `year` | 2017–2100 |
| `month` | 1–12 |
| `tableName` | Optional |
| `username` | Optional |

**Job metadata:** `operation: GSTIN_VERIFY_AND_FETCH_GSTR_2B`, plus `returnType`, `year`, `month`, `username`

**Mongo:** `gst_2b_compliance_data`  
**Logs:** `api_request_logs` (`GSTR-2B`)

---

### `POST /gst/verify-and-fetch/gstr-3b` → 202

Same as gstr-2b but for GSTR-3B.

**Body:** same shape (`year`, `month`, optional `tableName`, `username`)  
**Mongo:** `gst_3b_compliance_data`  
**Operation:** `GSTIN_VERIFY_AND_FETCH_GSTR_3B`

---

### `POST /gst/verify-and-fetch/gstr-track` → 202

Public GSTR track / return-filing status for **one financial year** across upload GSTINs. **No OTP.**

**Body**

```json
{
  "financialYear": "FY 2021-22",
  "tableName": "gst_uploaded_file_data"
}
```

`financialYear` is required (formats like `FY 2021-22` or `2021-22`).

**Skips Sandbox** if Mongo already has status `FETCHED` | `NO_RECORD` | `INVALID_FY` for that GSTIN + FY.

**Mongo:** `gst_gstR1_returns_compliance_data`  
**Operation:** `GSTIN_VERIFY_AND_FETCH_GSTR_TRACK`

**Response includes** `jobId`, `financialYear`, status URL.

---

### `POST /gst/verify-and-fetch/gstr-track/single` → 200 (synchronous)

Test / single-GSTIN track fetch + aggregation.

**Body**

```json
{
  "gstin": "09AAACP0252G2ZQ",
  "financialYear": "FY 2021-22",
  "customerId": "CUST001",
  "associatedLoanId": "LN000002",
  "tableName": "gst_uploaded_file_data",
  "forceRefresh": true
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `gstin` | Yes | |
| `financialYear` | Yes | |
| `customerId` | Yes | |
| `associatedLoanId` | Yes | Stored as `loanId` in Mongo |
| `tableName` | No | |
| `forceRefresh` | No | Default `true` |

**Response:** success envelope, `flow: "verify-and-fetch.gstr-track-single"`, `data` includes `fromCache`, `stored`, `status`, `aggregated`, etc.

---

## 10. Taxpayer OTP & session

Prerequisite for GSTR-2B/3B and notices.

### `POST /gst/taxpayer/otp/generate`

**Body**

```json
{ "gstin": "09AAACP0252G2ZQ", "username": "optional" }
```

If `username` omitted, resolved from upload table for that GSTIN.

**Response data (envelope):** `{ message, username, gstin, sandboxResponse }`  
Session state → `OTP_REQUIRED`.

---

### `POST /gst/taxpayer/otp/submit`

**Body**

```json
{ "gstin": "09AAACP0252G2ZQ", "otp": "123456", "username": "optional" }
```

**Response data:** `{ message, username, gstin, otpExpiresAt, state: "OTP_SUBMITTED" }`  
OTP TTL: `GST_TAXPAYER_OTP_TTL_MINUTES` (default 10).

---

### `POST /gst/taxpayer/otp/verify`

| Location | Fields |
|----------|--------|
| Query | `otp` **required** |
| Body | `gstin` required; `username` optional |

**Response data:** `{ message, username, gstin, state: "AUTHENTICATED", tokenExpiresAt }`

---

### `POST /gst/taxpayer/session/refresh`

**Body:** `{ "username": "...", "gstin": "..." }`  
**Response data:** authenticated session + `tokenExpiresAt`.

---

### `GET /gst/taxpayer/session/status`

| Query | Required |
|-------|----------|
| `username` | Yes |
| `gstin` | Yes |

**Response data:** `{ username, gstin, state, tokenExpiresAt, otpExpiresAt, lastVerifiedAt, lastRefreshedAt, lastError }`

---

## 11. Taxpayer returns (OTP) — yearly month loop

### `GET /gst/taxpayer/gstr-2b/:year`

| Param / query | Required |
|---------------|----------|
| `year` (path) | Yes |
| `gstin` | Yes |
| `customerId` | Yes |
| `associatedLoanId` | Yes |
| `username` | No |
| `dataSource` | No |

**Behaviour:** For each required month (see §4), use Mongo cache or fetch Sandbox month API; store in `gst_2b_compliance_data`.

**Response:** success envelope, `flow: "taxpayer-returns.gstr-2b"`, example `data`:

```json
{
  "message": "GSTR-2B year fetch completed for 2024.",
  "username": "...",
  "gstin": "...",
  "year": 2024,
  "monthsRequired": 12,
  "monthsProcessed": 12,
  "monthsFromCache": 3,
  "monthsSkipped": 3,
  "monthsStored": 8,
  "monthsFetched": 0,
  "monthsFailed": 1,
  "monthsMissingBeforeFetch": 9,
  "monthlyResults": []
}
```

### `GET /gst/taxpayer/gstr-3b/:year`

Same contract as gstr-2b; Mongo `gst_3b_compliance_data`; `flow: "taxpayer-returns.gstr-3b"`.

---

### `GET /gst/taxpayer/notices`

| Query | Required | Notes |
|-------|----------|--------|
| `username` | Yes | |
| `gstin` | Yes | |
| `date` | Yes | `DD/MM/YYYY`, within last 60 days |
| `associatedLoanId`, `customerId`, `dataSource` | No | |

**OTP required.** Envelope `flow: "taxpayer-returns.notices"`.

---

### `GET /gst/taxpayer/notices/:referenceId`

| Param / query | Required |
|---------------|----------|
| `referenceId` | Yes |
| `username`, `gstin` | Yes |
| tracking fields | Optional |

Envelope `flow: "taxpayer-returns.notice-detail"`.

---

## 12. Aggregation scheduler

### Config (env)

| Variable | Default | Meaning |
|----------|---------|---------|
| `GST_RETURN_AGGREGATION_SCHEDULER_ENABLED` | `false` | Start interval job on boot |
| `GST_RETURN_AGGREGATION_SCHEDULER_INTERVAL_MS` | `300000` (5 min) | Poll interval |
| `GST_AGGREGATION_SOURCE_TABLE` | `gst_uploaded_file_data` | Where loans/GSTINs come from |
| `ENABLE_MONGO` | — | Must be `true` |

### What the scheduler does each tick

1. List customer + loan pairs from the upload table.
2. For each pair × return type (`GSTR-2B`, `GSTR-3B`):
   - Expected GSTINs = primary + coapplicant from upload.
   - **Complete** = every expected GSTIN has **≥ 1** Mongo document for that return type (any year/month).
3. If complete → run aggregation for that customer into primary/coapplicant aggregation Postgres tables (physical table still secondary_gst_aggregation) (+ history).

Interval always runs with `returnType: ALL`.

### Manual trigger: `POST /gst/scheduler/aggregate-returns` → 200

**Body**

```json
{
  "returnType": "ALL",
  "customerId": "optional",
  "loanId": "optional",
  "tableName": "optional"
}
```

`returnType`: `GSTR-2B` | `GSTR-3B` | `ALL` (default `ALL`).

**Response:** success envelope, `flow: "scheduler.aggregate-returns"`, `data`:

```json
{
  "sourceTable": "gst_uploaded_file_data",
  "loansChecked": 10,
  "loansComplete": 4,
  "customersAggregated": ["CUST1"],
  "details": [
    {
      "customerId": "...",
      "loanId": "...",
      "returnType": "GSTR-2B",
      "expectedGstins": [],
      "storedGstins": [],
      "missingGstins": [],
      "complete": true,
      "aggregated": true
    }
  ]
}
```

### Aggregation write targets

| Trigger | History `change_source` (approx.) | Tables |
|---------|-----------------------------------|--------|
| After verify-and-fetch | `VERIFY_FETCH` | primary + coapplicant aggregation (+ history) |
| After / scheduler GSTR-2B | `GSTR-2B` | same |
| After / scheduler GSTR-3B | `GSTR-3B` | same |
| After gstr-track | `GSTR-TRACK` | same |

Columns: `customer_id`, `associated_loan_id`, `aggregation_variable` (JSON metrics).

---

## 13. Job operation matrix (quick reference)

| HTTP | Job / sync | Period | OTP | Mongo |
|------|------------|--------|-----|-------|
| `POST /gst/upload` | EXCEL job | N/A | No | — |
| `POST /gst/verify-and-fetch` | `GSTIN_VERIFY_AND_FETCH` | Once / GSTIN | No | `gst_compliance_data` |
| `POST .../gstr-2b` | `..._GSTR_2B` | **Month** | Yes | `gst_2b_compliance_data` |
| `POST .../gstr-3b` | `..._GSTR_3B` | **Month** | Yes | `gst_3b_compliance_data` |
| `POST .../gstr-track` | `..._GSTR_TRACK` | **FY** | No | `gst_gstR1_returns_compliance_data` |
| `POST .../gstr-track/single` | Sync | **FY** | No | same |
| `GET .../gstr-2b/:year` | Sync loop | **Year → months** | Yes | `gst_2b_compliance_data` |
| `GET .../gstr-3b/:year` | Sync loop | **Year → months** | Yes | `gst_3b_compliance_data` |

Batch jobs finish with metadata counts such as: `totalRows`, `verified`, `stored`, `skippedNoGstin`, `skippedInvalidGstin`, `skippedNoStatus`, `failed`, plus `skippedAlreadyExists` / `totalSourceRows` where applicable.

Tunables: `GST_VERIFY_BATCH_SIZE` (default 50), `GST_VERIFY_CONCURRENCY` (default 5).

---

## 14. Logging: two different tables

| | `api_request_logs` | `db_query_logs` |
|--|--------------------|-----------------|
| **What** | External Sandbox / taxpayer HTTP calls | Internal Postgres SQL + Mongo commands |
| **Why** | Dashboard operational status, retries, API name | Engineering / audit of DB activity |
| **When written** | During GST API usage (especially 2B/3B/notices) | Only if `ENABLE_DB_QUERY_LOGS=true` |
| **Read API** | `/gst/api-request-logs`, `/gst/api-logs` | `/gst/db-query-logs` |
| **Linked by** | loanId / gstin / customer | `requestId` (HTTP), `jobId` (background) |

---

## 15. RabbitMQ vs inline

| `ENABLE_RABBITMQ` | Behaviour |
|-------------------|------------|
| `false` (default for local) | Jobs run in-process (`void process...`) |
| `true` | Emits `excel_import`, `verify_parent`, `verify_chunk`; consumers in `GstConsumer` |

Requires `RABBITMQ_URL`. If broker is down at startup, app falls back to inline.

---

## 16. Environment variables (feature-related)

| Variable | Role |
|----------|------|
| `ENABLE_MONGO` / `MONGO_URI` | Mongo features |
| `ENABLE_RABBITMQ` / `RABBITMQ_URL` | Job queues |
| `ENABLE_DB_QUERY_LOGS` | Write `db_query_logs` |
| `DB_QUERY_LOG_BATCH_SIZE` / `DB_QUERY_LOG_FLUSH_MS` | Audit flush tuning |
| `JWT_AUTH_ENABLED` / `JWT_SECRET` / `JWT_EXPIRES_IN` | Auth |
| `AUTH_BOOTSTRAP_USERNAME` / `AUTH_BOOTSTRAP_PASSWORD` | Seed admin |
| `POSTGRES_*` / `POSTGRES_SYNC` / `POSTGRES_SSL` | Database |
| `GST_API_BASE_URL`, `GST_API_AUTH_URL`, `GST_API_KEY`/`_LIVE`, `GST_API_SECRET`/`_LIVE`, `GST_API_VERSION` | Sandbox |
| `GST_VERIFY_BATCH_SIZE`, `GST_VERIFY_CONCURRENCY`, `GST_API_MAX_RETRIES` | Fetch jobs |
| `GST_TAXPAYER_OTP_TTL_MINUTES`, `GST_TAXPAYER_TOKEN_TTL_HOURS` | OTP/session |
| `GST_TAXPAYER_REFRESH_ON_EVERY_REQUEST` | Refresh token before each taxpayer call (default true) |
| `GST_RETURN_AGGREGATION_SCHEDULER_ENABLED` / `_INTERVAL_MS` | Scheduler |
| `GST_AGGREGATION_SOURCE_TABLE` | Upload table for aggregation |
| `PORT` / `HOST` | HTTP listen |

---

## 17. Suggested testing order (manual)

1. `POST /auth/login` (if JWT on) → save token.  
2. `GET /gst/data` — confirm upload rows.  
3. `POST /gst/verify-and-fetch` → poll status → `GET /gst/compliance/public?loanId=...`.  
4. `POST /gst/verify-and-fetch/gstr-track` with a financial year → `GET /gst/aggregation?loanId=...`.  
5. OTP: generate → submit → verify → `GET /gst/taxpayer/gstr-2b/2024?...`.  
6. Optional: `POST /gst/scheduler/aggregate-returns`.  
7. Optional: `GET /gst/db-query-logs` (with `ENABLE_DB_QUERY_LOGS=true`).

---

## 18. Source files (for developers)

| Area | Path |
|------|------|
| HTTP routes | `src/modules/gst/gst.controller.ts` |
| Auth | `src/auth/auth.controller.ts` |
| Verify jobs | `src/modules/gst/services/gst-compliance.service.ts` |
| Aggregation | `src/modules/gst/services/gst-aggregation.service.ts` |
| Scheduler | `src/modules/gst/services/gst-return-aggregation-scheduler.service.ts` |
| Taxpayer returns | `src/modules/gst/services/gst-taxpayer-returns.service.ts` |
| OTP sessions | `src/modules/gst/services/gst-taxpayer-auth.service.ts` |
| External API client | `src/modules/gst/services/gst-api.service.ts` |
| API request logs | `src/modules/gst/services/api-request-log.service.ts` |
| DB query logs | `src/database/db-query-log/` |
| Schemas | `src/modules/gst/schemas/` |
| Entities | `src/entities/` |

---

*Generated from the NestJS codebase. When APIs change, update this file with the controller/service as source of truth.*
