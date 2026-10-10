CREATE TABLE IF NOT EXISTS vr_schema (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS vr_nodes (id bigserial PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'));
CREATE UNIQUE INDEX IF NOT EXISTS vr_nodes_name ON vr_nodes ((data->>'name'));
CREATE UNIQUE INDEX IF NOT EXISTS vr_one_local_node ON vr_nodes ((data->>'is_local')) WHERE data->>'is_local'='true';
CREATE TABLE IF NOT EXISTS vr_inbounds (
 id bigserial PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
 node_id bigint GENERATED ALWAYS AS ((data->>'node')::bigint) STORED NOT NULL REFERENCES vr_nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS vr_inbounds_node ON vr_inbounds(node_id);
CREATE UNIQUE INDEX IF NOT EXISTS vr_inbounds_port ON vr_inbounds(node_id, ((data->>'port')::integer)) WHERE (data->>'port')::integer > 0;
CREATE TABLE IF NOT EXISTS vr_clients (
 id bigserial PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
 inbound_id bigint GENERATED ALWAYS AS ((data->>'inbound')::bigint) STORED NOT NULL REFERENCES vr_inbounds(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS vr_clients_inbound ON vr_clients(inbound_id);
CREATE UNIQUE INDEX IF NOT EXISTS vr_clients_name ON vr_clients(inbound_id, (data->>'name'));
CREATE UNIQUE INDEX IF NOT EXISTS vr_subscription_token ON vr_clients ((data->>'subscription_token'));
CREATE TABLE IF NOT EXISTS vr_users (id bigserial PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'));
CREATE UNIQUE INDEX IF NOT EXISTS vr_user_name ON vr_users ((data->>'username'));
CREATE TABLE IF NOT EXISTS vr_api_keys (
 id bigserial PRIMARY KEY, data jsonb NOT NULL,
 user_id bigint GENERATED ALWAYS AS ((data->>'user')::bigint) STORED NOT NULL REFERENCES vr_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS vr_api_key_hash ON vr_api_keys ((data->>'_token_hash'));
CREATE TABLE IF NOT EXISTS vr_settings (id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS vr_audit (id bigserial PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS vr_audit_time ON vr_audit(created_at DESC);
CREATE TABLE IF NOT EXISTS vr_sessions (
 token_hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES vr_users(id) ON DELETE CASCADE,
 auth_version bigint NOT NULL, second_factor boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vr_sessions_expiry ON vr_sessions(expires_at);
CREATE TABLE IF NOT EXISTS vr_stats_cursors (
 node_id bigint NOT NULL REFERENCES vr_nodes(id) ON DELETE CASCADE, metric text NOT NULL,
 total bigint NOT NULL CHECK(total>=0), PRIMARY KEY(node_id, metric)
);
CREATE TABLE IF NOT EXISTS vr_traffic_windows (
 at timestamptz NOT NULL, node_id bigint NOT NULL, bytes bigint NOT NULL CHECK(bytes>=0), PRIMARY KEY(at,node_id)
);
CREATE INDEX IF NOT EXISTS vr_traffic_at ON vr_traffic_windows(at);
CREATE TABLE IF NOT EXISTS vr_jobs (
 node_id bigint PRIMARY KEY REFERENCES vr_nodes(id) ON DELETE CASCADE, attempts integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now(), last_error text NOT NULL DEFAULT '', rollback_ops jsonb NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vr_rate_limits (key text PRIMARY KEY, start_at timestamptz NOT NULL, hits integer NOT NULL);
CREATE INDEX IF NOT EXISTS vr_rate_limits_time ON vr_rate_limits(start_at);
CREATE TABLE IF NOT EXISTS vr_telegram_updates (id bigint PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
INSERT INTO vr_schema(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS vr_operations (id text PRIMARY KEY, nodes jsonb NOT NULL, status text NOT NULL DEFAULT 'prepared', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS vr_operations_pending ON vr_operations(created_at) WHERE status='prepared';
CREATE TABLE IF NOT EXISTS vr_accounts (id bigserial PRIMARY KEY, data jsonb NOT NULL,
 node_id bigint GENERATED ALWAYS AS ((data->>'_node')::bigint) STORED NOT NULL REFERENCES vr_nodes(id) ON DELETE CASCADE);
ALTER TABLE vr_clients ADD COLUMN IF NOT EXISTS account_id bigint GENERATED ALWAYS AS ((data->>'_account')::bigint) STORED REFERENCES vr_accounts(id);
CREATE INDEX IF NOT EXISTS vr_clients_account ON vr_clients(account_id) WHERE account_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS vr_import_jobs (
 id text PRIMARY KEY, actor_id bigint NOT NULL REFERENCES vr_users(id) ON DELETE CASCADE,
 node_id bigint NOT NULL REFERENCES vr_nodes(id) ON DELETE CASCADE, digest text NOT NULL,
 payload text NOT NULL, preview jsonb NOT NULL, result jsonb,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS vr_import_expiry ON vr_import_jobs(expires_at);
INSERT INTO vr_schema(version) VALUES(2) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS vr_telegram_actions (
 id text PRIMARY KEY, owner_id text NOT NULL, kind text NOT NULL, target_id bigint NOT NULL, action text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', used boolean NOT NULL DEFAULT false);
ALTER TABLE vr_telegram_updates ADD COLUMN IF NOT EXISTS reply jsonb;
ALTER TABLE vr_telegram_updates ADD COLUMN IF NOT EXISTS sent_at timestamptz;
