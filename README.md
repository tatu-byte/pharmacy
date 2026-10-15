# Run

Install Docker with Compose v2. From the repository root:

```sh
docker compose up --build
```

Open http://localhost:8080. API documentation: http://localhost:8000/docs.
PostgreSQL starts first; API migrations run automatically before the API accepts traffic.
The initial catalogue is empty. Run the seed command below to populate it.

Stop with `docker compose down`. Data stays in the named volume.

# Seed

In another terminal:

```sh
docker compose exec api python -m app.seed
```

This idempotent command creates 500 medicines, four rule periods each, and 2,000
dispenses across 2,000 synthetic patient references and a two-year window.
Try `MED0001` and `SYNTHETIC-00000` in the UI.

# Test

```sh
docker compose exec api python run_tests.py
```

Tests run in a new disposable PostgreSQL database and remove it afterwards.
The configured database user needs database-creation rights; the Compose user has them.
The application database is never truncated by the test runner.

Run a focused test with `docker compose exec api python run_tests.py tests/test_concurrency.py`.

Run the first-page latency benchmark after seeding:

```sh
docker compose exec api python -m app.benchmark --output /tmp/pharmacy-benchmark.json
docker compose cp api:/tmp/pharmacy-benchmark.json ./pharmacy-benchmark.json
```

The command fails if any measured p95 is at least 300ms. It includes EXPLAIN plans.
For an HTTP measurement through Nginx, add `--base-url http://web`.

Verify the production Angular build:

```sh
docker compose build web
```
