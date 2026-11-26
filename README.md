# Dispatchly

Live delivery dispatch and tracking: ASP.NET Core (.NET 10) API, Angular 22 web app,
PostgreSQL 17 + PostGIS 3.5, Redis and SignalR. The build plan is in [PLAN.md](PLAN.md).

## Local development

Prerequisites: .NET 10 SDK, Node 24, Docker.

1. **Database and Redis.** Copy the example env file and set a password:

   ```bash
   cp .env.example .env
   # edit .env: set POSTGRES_PASSWORD, and change POSTGRES_HOST_PORT
   # if something else already listens on 5432
   docker compose up -d --wait
   ```

   PostgreSQL + PostGIS and Redis listen on `127.0.0.1` only.

2. **API secrets.** The API reads its connection string and JWT signing key from
   [user-secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets) in Development
   (and from the `ConnectionStrings__Dispatchly` and `Jwt__SigningKey` environment variables
   elsewhere). They never go in a committed file. Use the password and port from your `.env`:

   ```bash
   dotnet user-secrets --project src/Dispatchly.Api set "ConnectionStrings:Dispatchly"      "Host=localhost;Port=5432;Database=dispatchly;Username=dispatchly;Password=<POSTGRES_PASSWORD>"
   dotnet user-secrets --project src/Dispatchly.Api set "Jwt:SigningKey" "$(openssl rand -base64 48)"
   ```

   The signing key must be at least 32 characters.

3. **API.**

   ```bash
   dotnet run --project src/Dispatchly.Api
   ```

   In Development the API applies migrations and seeds the demo city on start (PLAN.md §12):
   about 40 restaurants, 140 riders, a few hours of delivered orders and the orders from the
   designs (#DL-4810 to #DL-4823). Seeded times are relative to when it was seeded, so to start
   the demo afresh, reset the database with `docker compose down --volumes` and start again.

   Health check: <http://localhost:5080/health>. OpenAPI document (not served in Production):
   <http://localhost:5080/openapi/v1.json>.

4. **Web app.**

   ```bash
   cd web
   npm ci
   npm start
   ```

   Serves on <http://localhost:4200> and proxies `/api`, `/hubs` and `/health` to the API.

## API

REST under `/api/v1`, JSON in and out. Errors are
[problem details](https://www.rfc-editor.org/rfc/rfc9457) with a `code` to switch on, e.g. 409
`no_free_rider` or 422 `wrong_delivery_code`. Every call except demo sign-in needs a bearer
token:

```bash
curl -s -X POST localhost:5080/api/v1/auth/demo -H 'Content-Type: application/json'   -d '{"role":"Dispatcher"}'   # or "Rider" (Neha Gupta), "Customer" (Priya Nair)
```

| Method | Path                               | Who                  | What                                                                             |
| ------ | ---------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| POST   | `/api/v1/auth/demo`                | anyone               | A 12-hour token for the demo dispatcher, rider or customer                       |
| GET    | `/api/v1/orders?status=&late=`     | dispatcher           | The live order queue: needs rider, then running late, then by ETA                |
| GET    | `/api/v1/orders/{code}`            | dispatcher, customer | One order with rider, route and timeline (customers: their own)                  |
| POST   | `/api/v1/orders`                   | customer             | Place an order; the nearest free rider is assigned straight away if there is one |
| POST   | `/api/v1/orders/{code}/reassign`   | dispatcher           | Hand an order that hasn't been picked up to the next nearest free rider          |
| GET    | `/api/v1/restaurants?near=lat,lng` | customer             | The 20 nearest restaurants with their menus                                      |
| GET    | `/api/v1/stats/live`               | dispatcher           | Riders online, active orders, average delivery, running late, needs rider        |
| PUT    | `/api/v1/rider/status`             | rider                | Go online or offline                                                             |
| GET    | `/api/v1/rider/task`               | rider                | The rider's day and current task                                                 |
| POST   | `/api/v1/rider/task/pickup`        | rider                | Picked up, start ride                                                            |
| POST   | `/api/v1/rider/task/deliver`       | rider                | Complete the delivery with the customer's 4-digit code                           |
| POST   | `/api/v1/rider/location`           | rider                | A GPS position                                                                   |

The web app's client is generated from the OpenAPI document: `web/src/app/core/api/openapi.json`
is a copy of what the API serves, and `npm run api` (in `web/`) turns it into TypeScript types
for `ApiClient`.

## Tests

```bash
dotnet test --solution Dispatchly.slnx
cd web && npm test -- --watch=false
```

The API's integration tests run against a real PostGIS in a throwaway container
([Testcontainers](https://dotnet.testcontainers.org/)), so Docker must be running; the first run
pulls `postgis/postgis:17-3.5`. They include the 50-concurrent-orders assignment test.

When the API contract changes, the OpenAPI test rewrites `web/src/app/core/api/openapi.json` and
fails. Run `npm run api` in `web/` to regenerate the client types, then commit both files. CI
fails while either is out of date.

New migrations: `dotnet tool restore`, then
`dotnet ef migrations add <Name> --project src/Dispatchly.Infrastructure`.

Stop the containers with `docker compose down` (add `--volumes` to delete the database).
