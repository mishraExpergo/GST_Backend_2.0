# GST Backend deployment

## Infra
- Local deps: `docker compose up -d` (Postgres, Mongo, RabbitMQ)
- Or managed: set `POSTGRES_*` + `MONGO_URI` in `.env` (current setup uses RDS + Atlas)

## Env
Copy `.env.example` → `.env`. Match Sandbox keys to `GST_API_BASE_URL`.

## Schema
Keep `POSTGRES_SYNC=false`. On startup `SchemaBootstrapService` creates jobs / job_tasks / aggregation tables. Manual: `psql ... -f scripts/bootstrap-schema.sql`.

## Run
```bash
npm ci
npm run build
npm run start:prod
```

## Smoke
```bash
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"...\"}"
curl http://localhost:3000/gst/api-logs -H "Authorization: Bearer <token>"
curl -X POST http://localhost:3000/gst/verify-and-fetch -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{}"
```
