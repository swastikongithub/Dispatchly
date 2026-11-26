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
| GET    | `/api/v1/stats/live`               | dispatcher           | Riders online, free and on a delivery, active orders, average delivery and more  |
| GET    | `/api/v1/live/snapshot`            | dispatcher           | The dashboard's first paint: riders on shift, the order queue and the stats      |
| GET    | `/api/v1/live/public`              | anyone               | The landing page's map and numbers: positions and stats, no names or orders      |
| PUT    | `/api/v1/rider/status`             | rider                | Go online or offline                                                             |
| GET    | `/api/v1/rider/task`               | rider                | The rider's day and current task                                                 |
| POST   | `/api/v1/rider/task/pickup`        | rider                | Picked up, start ride                                                            |
| POST   | `/api/v1/rider/task/deliver`       | rider                | Complete the delivery with the customer's 4-digit code                           |
| POST   | `/api/v1/rider/location`           | rider                | A GPS position                                                                   |

The web app's client is generated from the OpenAPI document: `web/src/app/core/api/openapi.json`
is a copy of what the API serves, and `npm run api` (in `web/`) turns it into TypeScript types
for `ApiClient`.

## Real time

The SignalR hub `/hubs/live` sends rider positions every 2 s, plus order, ETA, stats and task
changes as they happen. Its groups, messages, payloads and the reconnect rule (join, GET the
snapshot, then apply only newer messages) are in [docs/realtime.md](docs/realtime.md). The web
app and the mobile app both depend on it.

## City simulator

The API runs a simulator that keeps the demo city alive (PLAN.md §3.7). It acts only through the
same use cases as the apps:

- Free riders drift between restaurants and go on and off shift.
- New orders come in, busier at lunch and dinner.
- Riders ride their routes to the restaurant and the door, then deliver with the code.
- Some kitchens and some roads are slow, so orders do run late.

The demo rider (Neha Gupta) rides by herself but waits for the visitor to slide "Picked up" and
"Delivered". If nobody does, she slides after `DemoRiderPatience`.

| Setting                       | Default    | What                                                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `Simulator:Enabled`           | `true`     | Run it. On one API instance only: each would add its own orders                                  |
| `Simulator:SpeedMultiplier`   | `1`        | Riders move this many times faster, and its own waits are shorter. Kitchens keep their prep time |
| `Simulator:OrdersPerMinute`   | `1.5`      | New orders a minute across the city, before the time-of-day curve                                |
| `Simulator:RandomSeed`        | `4817`     | The same seed gives the same speeds, delays and orders                                           |
| `Simulator:DemoRiderPatience` | `00:02:00` | How long the demo rider waits for the visitor at the café and the door                           |
| `Simulator:TickInterval`      | `00:00:02` | How often it moves the city                                                                      |
| `Live:BatchInterval`          | `00:00:02` | How often the hub sends positions                                                                |
| `Workers:LiveBroadcast`       | `true`     | Send positions, ETAs and stats on that tick                                                      |

Set them in `appsettings.Development.json`, with user-secrets, or as environment variables
(`Simulator__SpeedMultiplier=10`). The simulator never writes to the database itself, so orders
it places stay there like any other.

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
