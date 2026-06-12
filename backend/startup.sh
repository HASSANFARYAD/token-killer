#!/usr/bin/env bash
set -euo pipefail

python - <<'PY'
import os
import sys
import time

import psycopg

database_url = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
for attempt in range(1, 31):
    try:
        with psycopg.connect(database_url, connect_timeout=3):
            break
    except psycopg.OperationalError as exc:
        if attempt == 30:
            raise
        print(f"Waiting for database ({attempt}/30): {exc}", file=sys.stderr)
        time.sleep(2)
PY

python -m alembic upgrade head
python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
