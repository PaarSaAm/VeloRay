#!/usr/bin/env python3
"""Export only the PasarGuard tables needed by VeloRay. Does not migrate admins."""
import argparse
import json
import os
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse, unquote, parse_qs

TABLES = ["users", "inbounds", "core_configs", "users_groups_association", "inbounds_groups_association", "user_usage_logs"]

def main():
    parser = argparse.ArgumentParser(description="Export a PasarGuard SQLite or PostgreSQL database to VeloRay import JSON")
    parser.add_argument("--sqlite", help="Path to a PasarGuard SQLite backup")
    parser.add_argument("--output", required=True, help="New private JSON file; existing files are not replaced")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists():
        raise SystemExit("Output already exists; choose a new filename")
    tables = {}
    if args.sqlite:
        source = Path(args.sqlite).resolve()
        db = sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)
        db.row_factory = sqlite3.Row
        db.execute("pragma trusted_schema=OFF")
        db.execute("pragma query_only=ON")
        for table in TABLES:
            tables[table] = [dict(row) for row in db.execute('select * from "' + table + '" limit 20001')]
        db.close()
    else:
        # Pass connection secrets through the child environment, never its command line.
        dsn = os.environ.get("SQLALCHEMY_DATABASE_URL", os.environ.get("DATABASE_URL", ""))
        url = urlparse(dsn.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql+psycopg://", "postgresql://"))
        if url.scheme not in ("postgresql", "postgres") or not url.hostname:
            raise SystemExit("Set SQLALCHEMY_DATABASE_URL or DATABASE_URL to the PasarGuard PostgreSQL connection URL, or use --sqlite")
        env = dict(os.environ, PGHOST=url.hostname, PGPORT=str(url.port or 5432), PGDATABASE=unquote(url.path.lstrip("/")), PGUSER=unquote(url.username or ""), PGPASSWORD=unquote(url.password or ""))
        query = parse_qs(url.query)
        if "sslmode" in query:
            env["PGSSLMODE"] = query["sslmode"][0]
        for table in TABLES:
            result = subprocess.run(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", 'SELECT COALESCE(json_agg(t),\'[]\'::json) FROM (SELECT * FROM "' + table + '" LIMIT 20001) t'], env=env, capture_output=True, text=True, timeout=60)
            if result.returncode:
                raise SystemExit("Could not export required table " + table + "; verify connection and read permissions")
            tables[table] = json.loads(result.stdout)
    if sum(map(len, tables.values())) > 20000:
        raise SystemExit("Export exceeds 20000 source records; export a smaller dataset")
    with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, prefix=".veloray-export-", delete=False, encoding="utf-8") as target:
        temporary = Path(target.name)
        os.chmod(temporary, 0o600)
        json.dump({"source": "pasarguard", "tables": tables}, target, ensure_ascii=False, allow_nan=False)
    try:
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    print("Private migration export created: " + str(output))

if __name__ == "__main__":
    main()
