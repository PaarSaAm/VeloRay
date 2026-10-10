"""Read-only, bounded adapters. Embedded in the panel; never execute dump SQL."""
import json
import sqlite3
import sys
import time
import resource
from collections import defaultdict

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
MAX_ROWS = 20000
TABLES = (
    "inbounds", "client_traffics", "clients", "client_inbounds", "client_global_traffics",
    "users", "core_configs", "users_groups_association", "inbounds_groups_association", "user_usage_logs",
)

def data(value):
    if isinstance(value, (dict, list)):
        return value
    if value is None or value == "":
        return {}
    return json.loads(value)

def integer(value):
    return int(value or 0)

def normalize(tables):
    warnings = []
    inbound_rows = tables.get("inbounds", [])
    users = tables.get("users", [])
    if users and "proxy_settings" in users[0] or "core_configs" in tables:
        source = "pasarguard"
        configs = tables.get("core_configs", [])
        if not configs:
            raise ValueError("PasarGuard export is missing core_configs; the database inbound table only stores tags")
        tags = {integer(r["id"]): r["tag"] for r in inbound_rows}
        group_tags = defaultdict(set)
        for r in tables.get("inbounds_groups_association", []):
            if integer(r["inbound_id"]) in tags:
                group_tags[integer(r["group_id"])].add(tags[integer(r["inbound_id"])])
        user_tags = defaultdict(set)
        for r in tables.get("users_groups_association", []):
            user_tags[integer(r["user_id"])].update(group_tags[integer(r.get("groups_id", r.get("group_id")))])
        resets = defaultdict(int)
        for r in tables.get("user_usage_logs", []):
            resets[integer(r.get("user_id"))] += integer(r.get("used_traffic_at_reset"))
        out = []
        unattached = 0
        for core in configs:
            if core.get("type", "xray").lower() != "xray":
                warnings.append("Non-Xray core configuration was skipped")
                continue
            config = data(core.get("config"))
            for index, original in enumerate(config.get("inbounds", [])):
                tag = original.get("tag", "")
                protocol = original.get("protocol", "")
                if protocol == "dokodemo-door" and tag.lower() in ("api", "stats"):
                    continue
                entry = {"source_id": str(core["id"]) + ":" + (tag or str(index)), "name": tag or "Imported inbound", "listen": original.get("listen", "0.0.0.0"), "port": original.get("port", 0), "protocol": protocol, "settings": original.get("settings", {}), "stream_settings": original.get("streamSettings", {}), "enabled": True, "clients": []}
                for u in users:
                    ps = data(u.get("proxy_settings"))
                    if tag not in user_tags[integer(u["id"])] or protocol not in ps:
                        continue
                    proxy = ps[protocol]
                    used = integer(u.get("used_traffic"))
                    entry["clients"].append({"name": u["username"], "credential": proxy.get("id", proxy.get("uuid", proxy.get("password", proxy.get("auth_str", "")))), "enabled": u.get("status") == "active", "expires_at": u.get("expire"), "traffic_limit_bytes": integer(u.get("data_limit")), "used_traffic_bytes": used, "lifetime_traffic_bytes": used + resets[integer(u["id"])], "note": u.get("note") or "", "subscription_token": "", "protocol_settings": {"flow": proxy["flow"]} if "flow" in proxy else {}, "source_account": "user:" + str(u["id"]), "source_meta": {"status": u.get("status"), "reset_strategy": u.get("data_limit_reset_strategy"), "on_hold_expire_duration": u.get("on_hold_expire_duration")}})
                out.append(entry)
        matched = {c["source_account"] for i in out for c in i["clients"]}
        unattached = sum("user:" + str(u["id"]) not in matched for u in users)
        if unattached:
            warnings.append(str(unattached) + " users have no matching Xray inbound/group and cannot be imported")
        warnings.append("PasarGuard subscription tokens are regenerated; distribute the new VeloRay subscription addresses")
        warnings.append("Calendar resets, on-hold activation, host overrides and node credentials need review in VeloRay")
        return {"source": source, "inbounds": out, "warnings": warnings}

    if not inbound_rows or "protocol" not in inbound_rows[0] or "settings" not in inbound_rows[0]:
        raise ValueError("Unrecognized database schema; use a 3x-ui SQLite backup or a PasarGuard tables JSON export")
    source = "3x-ui"
    traffic = defaultdict(int)
    traffic_by_email = defaultdict(int)
    for r in tables.get("client_traffics", []):
        used = integer(r.get("up")) + integer(r.get("down"))
        traffic[(integer(r.get("inbound_id")), r.get("email", ""))] += used
        traffic_by_email[r.get("email", "")] += used
    global_traffic = {r.get("email", ""): integer(r.get("up")) + integer(r.get("down")) for r in tables.get("client_global_traffics", [])}
    globals_by_id = {integer(r["id"]): r for r in tables.get("clients", []) if "email" in r}
    linked = defaultdict(dict)
    for link in tables.get("client_inbounds", []):
        u = globals_by_id.get(integer(link["client_id"]))
        if u:
            linked[integer(link["inbound_id"])][u["email"]] = u
    out = []
    for row in inbound_rows:
        iid = integer(row["id"])
        settings = data(row["settings"])
        stream = data(row.get("stream_settings"))
        cs = {r.get("email", ""): r for r in settings.get("clients", [])}
        for name, u in linked[iid].items():
            cs[name] = dict(cs.get(name, {}), **{
                "email": name, "id": u.get("uuid"), "password": u.get("password"), "auth": u.get("auth"),
                "enable": u.get("enable", True), "expiryTime": u.get("expiry_time", 0), "totalGB": u.get("total_gb", 0),
                "subId": u.get("sub_id", ""), "comment": u.get("comment", ""), "flow": u.get("flow", ""),
            })
        entry = {"source_id": str(iid), "name": row.get("remark") or row.get("tag") or "Imported " + str(iid), "listen": row.get("listen") or "0.0.0.0", "port": row.get("port", 0), "protocol": row["protocol"], "settings": settings, "stream_settings": stream, "enabled": bool(row.get("enable", 1)), "clients": []}
        for index, c in enumerate(cs.values()):
            email = c.get("email") or "Imported client " + str(index + 1)
            global_user = linked[iid].get(email)
            used = global_traffic.get(email, traffic_by_email[email]) if global_user else traffic[(iid, email)]
            entry["clients"].append({"name": email, "credential": c.get("id") if row["protocol"] in ("vless", "vmess") else c.get("password", c.get("auth", "")), "enabled": bool(c.get("enable", True)), "expires_at": c.get("expiryTime", 0), "traffic_limit_bytes": integer(c.get("totalGB")), "used_traffic_bytes": used, "lifetime_traffic_bytes": used, "note": c.get("comment") or "", "subscription_token": c.get("subId") or "", "protocol_settings": {"flow": c.get("flow", "")}, "source_account": "global:" + str(global_user["id"]) if global_user else "", "source_meta": {"limit_ip": c.get("limitIp", 0), "telegram_id": c.get("tgId", ""), "reset": c.get("reset", 0)}})
        if not cs and row["protocol"] == "shadowsocks" and settings.get("password"):
            entry["clients"].append({"name": entry["name"], "credential": settings["password"], "enabled": entry["enabled"], "expires_at": row.get("expiry_time", 0), "traffic_limit_bytes": integer(row.get("total")), "used_traffic_bytes": integer(row.get("up")) + integer(row.get("down")), "lifetime_traffic_bytes": integer(row.get("up")) + integer(row.get("down")), "subscription_token": "", "protocol_settings": {}, "source_account": "", "note": ""})
        out.append(entry)
    warnings.append("Host overrides, remote node credentials, IP limits, fallback chains and calendar reset schedules need review; they are not activated automatically")
    return {"source": source, "inbounds": out, "warnings": warnings}

def main(path):
    with open(path, "rb") as f:
        header = f.read(16)
    if header == b"SQLite format 3\x00":
        db = sqlite3.connect("file:" + path + "?mode=ro&immutable=1", uri=True)
        db.row_factory = sqlite3.Row
        db.execute("pragma trusted_schema=OFF")
        db.execute("pragma query_only=ON")
        deadline = time.monotonic() + 10
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
        available = {r["name"]: r["sql"] or "" for r in db.execute("select name, sql from sqlite_master where type='table'")}
        tables = {}
        total = 0
        for table in TABLES:
            if table not in available:
                continue
            if "VIRTUAL TABLE" in available[table].upper():
                raise ValueError("Virtual tables are not accepted")
            # Do not read 3x-ui panel administrator credentials from the users table.
            if table == "users" and "proxy_settings" not in [r["name"] for r in db.execute('pragma table_info("users")')]:
                continue
            rows = [dict(r) for r in db.execute('select * from "' + table + '" limit ' + str(MAX_ROWS + 1))]
            total += len(rows)
            if total > MAX_ROWS:
                raise ValueError("Import contains more than 20000 source records")
            tables[table] = rows
        db.close()
    else:
        with open(path, encoding="utf-8") as f:
            root = json.load(f)
        tables = root.get("tables", {})
        if not isinstance(tables, dict) or not tables:
            raise ValueError("JSON must contain the tables object; SQL dumps are not executed")
        tables = {t: rows for t, rows in tables.items() if t in TABLES}
        if any(not isinstance(rows, list) for rows in tables.values()) or sum(map(len, tables.values())) > MAX_ROWS:
            raise ValueError("Invalid tables export or record limit exceeded")
    result = normalize(tables)
    if sum(len(i["clients"]) for i in result["inbounds"]) > 10000 or len(result["inbounds"]) > 500:
        raise ValueError("Select at most 500 inbounds and 10000 client connections per import")
    print(json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(",", ":")))

try:
    main(sys.argv[1])
except (ValueError, KeyError, TypeError, sqlite3.Error, OSError, OverflowError) as error:
    print("Backup schema is invalid or unsupported: " + str(error)[:240], file=sys.stderr)
    sys.exit(1)
