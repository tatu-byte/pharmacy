# Run

Install Docker with Compose v2. From the repository root:

```sh
docker compose up --build
```

Open http://localhost:8080. API documentation: http://localhost:8000/docs.
Migrations apply automatically before the API starts. The initial catalogue is
empty. Run the seed command below to populate it.

Stop with `docker compose down`. Data stays in the named volume. After pulling
changes, rerun `docker compose up --build`.

# Seed

In another terminal:

```sh
docker compose run --rm migrate python -m app.seed
```

This idempotent command creates 500 medicines, four rule periods each, and 2,000
dispenses across 2,000 synthetic patient references and a two-year window.
Try `MED0001` and `SYNTHETIC-00000` in the UI.

# Test

Run the backend database suite and browser regression suite inside containers:

```sh
sh scripts/test.sh
```

Backend tests create and remove a disposable PostgreSQL database; they do not
truncate application data. Browser tests build the production Angular bundle
and use controlled API responses. The first browser-test build downloads Chromium.

Run either suite separately:

```sh
docker compose run --rm migrate python run_tests.py
docker compose run --build --rm browser-tests
```

Run a focused database test:

```sh
docker compose run --rm migrate python run_tests.py tests/test_concurrency.py
```
