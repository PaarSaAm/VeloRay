package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
)

func deviceHeader(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) > limit {
		return ""
	}
	for _, ch := range value {
		if unicode.IsControl(ch) {
			return ""
		}
	}
	return value
}
func subscriptionDevice(r *http.Request) Data {
	hwid := deviceHeader(r.Header.Get("X-HWID"), 256)
	if hwid == "" {
		return nil
	}
	return Data{"hwid": hwid, "device_os": deviceHeader(r.Header.Get("X-Device-OS"), 128), "os_version": deviceHeader(r.Header.Get("X-Ver-OS"), 128), "device_model": deviceHeader(r.Header.Get("X-Device-Model"), 256), "user_agent": deviceHeader(r.UserAgent(), 512)}
}
func deviceOwner(c Data) (string, int64) {
	if id := num(c, "_account"); id > 0 {
		return "account_id", id
	}
	return "client_id", num(c, "id")
}
func (s *Server) recordSubscriptionDevice(r *http.Request, c Data) error {
	d := subscriptionDevice(r)
	if r.Method != http.MethodGet || d == nil {
		return nil
	}
	ctx := r.Context()
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	field, id := deviceOwner(c)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "device:"+field+":"+fmt.Sprint(id)); err != nil {
		return err
	}
	var count int
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT count(*),COALESCE(bool_or(hwid=$2),false) FROM vr_client_devices WHERE `+field+`=$1`, id, str(d, "hwid")).Scan(&count, &exists); err != nil {
		return err
	}
	if count >= 1000 && !exists {
		return nil
	}
	hwid := str(d, "hwid")
	delete(d, "hwid")
	for key, value := range d {
		if value == "" {
			delete(d, key)
		}
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO vr_client_devices(`+field+`,hwid,data) VALUES($1,$2,$3) ON CONFLICT(`+field+`,hwid) DO UPDATE SET data=vr_client_devices.data || EXCLUDED.data,last_seen_at=now()`, id, hwid, string(raw))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Server) clientConnections(ctx context.Context, id int64, kind string) (Data, error) {
	c, err := get(ctx, s.Store.Pool, "clients", id)
	if err != nil {
		return nil, err
	}
	if kind == "devices" {
		field, owner := deviceOwner(c)
		rows, err := s.Store.Pool.Query(ctx, `SELECT data || jsonb_build_object('id',id,'hwid',hwid,'first_seen_at',first_seen_at,'last_seen_at',last_seen_at) FROM vr_client_devices WHERE `+field+`=$1 ORDER BY last_seen_at DESC,id DESC LIMIT 1000`, owner)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		entries := []Data{}
		for rows.Next() {
			var raw []byte
			if err = rows.Scan(&raw); err != nil {
				return nil, err
			}
			entry, err := decode(raw)
			if err != nil {
				return nil, err
			}
			entries = append(entries, entry)
		}
		return Data{"items": entries, "count": len(entries)}, rows.Err()
	}
	members := []Data{c}
	if account := num(c, "_account"); account > 0 {
		members, err = list(ctx, s.Store.Pool, "clients", "WHERE account_id=$1 ORDER BY id", account)
		if err != nil {
			return nil, err
		}
	}
	nodes, err := list(ctx, s.Store.Pool, "nodes", `WHERE id IN (SELECT node_id FROM vr_inbounds WHERE id IN (SELECT inbound_id FROM vr_clients WHERE id=$1 OR ($2::bigint>0 AND account_id=$2)))`, id, num(c, "_account"))
	if err != nil {
		return nil, err
	}
	inbounds, err := list(ctx, s.Store.Pool, "inbounds", `WHERE id IN (SELECT inbound_id FROM vr_clients WHERE id=$1 OR ($2::bigint>0 AND account_id=$2))`, id, num(c, "_account"))
	if err != nil {
		return nil, err
	}
	byNode, byInbound := map[int64]Data{}, map[int64]Data{}
	for _, n := range nodes {
		byNode[num(n, "id")] = n
	}
	for _, i := range inbounds {
		byInbound[num(i, "id")] = i
	}
	ips, complete := connectedIPs(members, byInbound, byNode, time.Now().UTC())
	return Data{"items": ips, "count": len(ips), "available": complete, "observed_at": stamp()}, nil
}
func connectedIPs(members []Data, inbounds, nodes map[int64]Data, now time.Time) ([]Data, bool) {
	entries := map[string]Data{}
	complete := true
	for _, c := range members {
		i := inbounds[num(c, "inbound")]
		n := nodes[num(i, "node")]
		core := fallback(str(i, "core"), "xray")
		available := flag(obj(n, "_online_ip_cores"), core)
		if len(obj(n, "_online_ip_cores")) == 0 {
			available = flag(n, "_online_ips_available")
		}
		observed, err := timestamp(n, "_telemetry_at")
		if err != nil || now.Sub(observed) < 0 || now.Sub(observed) > 20*time.Second || !available || !flag(n, "enabled") || !flag(i, "enabled") {
			complete = false
			continue
		}
		if !active(c, now) {
			continue
		}
		for ip, value := range obj(obj(n, "_online_ips"), fmt.Sprintf("veloray:%d:%s", num(c, "id"), str(c, "name"))) {
			address := net.ParseIP(ip)
			if address == nil {
				continue
			}
			ip = address.String()
			entry := entries[ip]
			if entry == nil {
				entry = Data{"ip": ip, "last_seen_at": stamp(observed), "connections": []any{}}
				entries[ip] = entry
			}
			if at := num(Data{"at": value}, "at"); at > 0 && at <= now.Unix() {
				candidate := time.Unix(at, 0).UTC()
				previous, _ := timestamp(entry, "last_seen_at")
				if len(array(entry, "connections")) == 0 || candidate.After(previous) {
					entry["last_seen_at"] = stamp(candidate)
				}
			}
			entry["connections"] = append(array(entry, "connections"), Data{"node": num(n, "id"), "node_name": str(n, "name"), "inbound": num(i, "id"), "inbound_name": str(i, "name"), "core": core})
		}
	}
	output := []Data{}
	for _, entry := range entries {
		output = append(output, entry)
	}
	sort.Slice(output, func(a, b int) bool { return str(output[a], "ip") < str(output[b], "ip") })
	return output, complete
}
