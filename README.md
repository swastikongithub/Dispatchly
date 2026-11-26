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

2. **API.**

   ```bash
   dotnet run --project src/Dispatchly.Api
   ```

   Health check: <http://localhost:5080/health>. OpenAPI document (Development only):
   <http://localhost:5080/openapi/v1.json>.

3. **Web app.**

   ```bash
   cd web
   npm ci
   npm start
   ```

   Serves on <http://localhost:4200>.

## Tests

```bash
dotnet test --solution Dispatchly.slnx
cd web && npm test -- --watch=false
```

Stop the containers with `docker compose down` (add `--volumes` to delete the database).
