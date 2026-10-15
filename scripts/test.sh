#!/bin/sh
set -eu
docker compose run --rm migrate python run_tests.py
docker compose run --build --rm browser-tests
