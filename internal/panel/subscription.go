package panel

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	qrcode "github.com/skip2/go-qrcode"
	"html/template"
	"net/http"
	"strings"
	"time"
)

func clashConfig(c, i, n Data) (Data, error) {
	p, t := str(i, "protocol"), str(i, "transport")
	if !oneOf(p, "vless", "vmess", "trojan", "shadowsocks", "hysteria") {
		return nil, fmt.Errorf("Clash output is unavailable for %s", p)
	}
	if !oneOf(t, "raw", "ws", "grpc", "xhttp", "hysteria") {
		return nil, fmt.Errorf("Clash output is unavailable for %s transport", t)
	}
	name := "VeloRay · " + str(c, "name")
	v := Data{"name": name, "server": str(n, "public_host"), "port": num(i, "port"), "udp": true}
	switch p {
	case "vless", "vmess":
		v["type"] = p
		v["uuid"] = str(c, "credential")
		if p == "vmess" {
			v["alterId"] = 0
			v["cipher"] = "auto"
		}
		if str(i, "flow") != "" {
			v["flow"] = str(i, "flow")
		}
	case "trojan":
		v["type"] = p
		v["password"] = str(c, "credential")
	case "shadowsocks":
		v["type"] = "ss"
		v["cipher"] = fallback(str(obj(i, "protocol_settings"), "method"), "aes-256-gcm")
		v["password"] = str(c, "credential")
	case "hysteria":
		v["type"] = "hysteria2"
		v["password"] = str(c, "credential")
		v["sni"] = fallback(str(i, "tls_server_name"), str(n, "public_host"))
	}
	switch t {
	case "ws":
		v["network"] = "ws"
		v["ws-opts"] = Data{"path": fallback(str(i, "path"), "/"), "headers": Data{"Host": str(i, "host_header")}}
	case "grpc":
		v["network"] = "grpc"
		v["grpc-opts"] = Data{"grpc-service-name": fallback(str(i, "service_name"), str(i, "name"))}
	case "xhttp":
		v["network"] = "xhttp"
		v["xhttp-opts"] = Data{"path": fallback(str(i, "path"), "/"), "mode": "auto"}
	case "raw":
		v["network"] = "tcp"
	}
	if str(i, "security") == "tls" {
		v["tls"] = true
		v["servername"] = fallback(str(i, "tls_server_name"), str(n, "public_host"))
	}
	if str(i, "security") == "reality" {
		v["tls"] = true
		v["servername"] = str(i, "reality_server_name")
		v["client-fingerprint"] = "chrome"
		v["reality-opts"] = Data{"public-key": str(i, "reality_public_key"), "short-id": str(i, "reality_short_id")}
	}
	return Data{"proxies": []any{v}, "proxy-groups": []any{Data{"name": "VeloRay", "type": "select", "proxies": []any{name}}}, "rules": []any{"MATCH,VeloRay"}}, nil
}
func (s *Server) subscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		writeJSON(w, 405, Data{"detail": "method not allowed"})
		return
	}
	token := strings.TrimPrefix(r.URL.Path, "/sub/")
	if len(token) < 16 || len(token) > 96 || strings.Contains(token, "/") {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	cfg, e := settings(ctx, s.Store.Pool)
	if e != nil {
		s.respond(w, r, nil, 0, e)
		return
	}
	if !flag(cfg, "subscription_enabled") || flag(cfg, "maintenance_mode") {
		writeJSON(w, 503, Data{"detail": "Subscriptions are temporarily unavailable"})
		return
	}
	rows, e := list(ctx, s.Store.Pool, "clients", "WHERE data->>'subscription_token'=$1", token)
	if e != nil {
		s.respond(w, r, nil, 0, e)
		return
	}
	if len(rows) != 1 {
		http.NotFound(w, r)
		return
	}
	c := rows[0]
	i, e := get(ctx, s.Store.Pool, "inbounds", num(c, "inbound"))
	if e != nil {
		http.NotFound(w, r)
		return
	}
	n, e := get(ctx, s.Store.Pool, "nodes", num(i, "node"))
	if e != nil {
		http.NotFound(w, r)
		return
	}
	if !active(c, time.Now()) || !flag(i, "enabled") || !flag(n, "enabled") {
		writeJSON(w, 403, Data{"detail": "This subscription is inactive, expired or out of traffic"})
		return
	}
	exp := int64(0)
	if t, e := timestamp(c, "expires_at"); e == nil {
		exp = t.Unix()
	}
	w.Header().Set("Subscription-Userinfo", fmt.Sprintf("upload=0; download=%d; total=%d; expire=%d", num(c, "used_traffic_bytes"), num(c, "traffic_limit_bytes"), exp))
	w.Header().Set("Profile-Title", "base64:"+base64.StdEncoding.EncodeToString([]byte(str(cfg, "site_name")+" · "+str(c, "name"))))
	w.Header().Set("Profile-Update-Interval", "12")
	for key, field := range map[string]string{"Support-URL": "support_url", "Announce-URL": "announcement_url"} {
		if str(cfg, field) != "" {
			w.Header().Set(key, str(cfg, field))
		}
	}
	if str(cfg, "announcement") != "" {
		w.Header().Set("Announce", "base64:"+base64.StdEncoding.EncodeToString([]byte(str(cfg, "announcement"))))
	}
	w.Header().Set("Vary", "Accept, User-Agent")
	format := r.URL.Query().Get("format")
	if format == "" {
		if strings.Contains(r.Header.Get("Accept"), "text/html") {
			format = "portal"
		} else {
			format = "base64"
		}
	}
	link := shareLink(c, i, n)
	profile := profile(c, i, n)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	var body string
	switch format {
	case "base64", "b64":
		if link == "" {
			writeJSON(w, 400, Data{"detail": "Use the WireGuard download or account details for this protocol"})
			return
		}
		body = base64.StdEncoding.EncodeToString([]byte(link + "\n"))
	case "raw", "text":
		body = link + "\n"
		if link == "" {
			writeJSON(w, 400, Data{"detail": "No portable URI is available for this protocol"})
			return
		}
	case "json":
		writeJSON(w, 200, Data{"name": str(c, "name"), "protocol": str(i, "protocol"), "link": link, "profile": profile, "used_traffic_bytes": num(c, "used_traffic_bytes"), "traffic_limit_bytes": num(c, "traffic_limit_bytes"), "expires_at": c["expires_at"]})
		return
	case "clash", "yaml":
		data, e := clashConfig(c, i, n)
		if e != nil {
			writeJSON(w, 400, Data{"detail": e.Error()})
			return
		}
		b, _ := json.MarshalIndent(data, "", "  ")
		body = string(b) + "\n"
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	case "wireguard", "wg":
		if profile == "" {
			writeJSON(w, 400, Data{"detail": "No WireGuard profile is available"})
			return
		}
		body = profile
		w.Header().Set("Content-Disposition", `attachment; filename="veloray.conf"`)
	case "portal", "html":
		s.portal(w, r, c, i, n, cfg, link, profile)
		return
	default:
		writeJSON(w, 400, Data{"detail": "Unknown subscription format"})
		return
	}
	if r.Method != "HEAD" {
		_, _ = w.Write([]byte(body))
	}
}
func fmtBytes(value int64) string {
	v := float64(max(0, value))
	unit := "B"
	for _, u := range []string{"B", "KB", "MB", "GB", "TB", "PB"} {
		unit = u
		if v < 1024 {
			break
		}
		v /= 1024
	}
	return fmt.Sprintf("%.1f %s", v, unit)
}

var portalTemplate = template.Must(template.New("portal").Parse(`<!doctype html><html lang="{{.Locale}}" dir="{{.Direction}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{{.Site}} · {{.Name}}</title><style>:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#101316;color:#edf2f4}*{box-sizing:border-box}body{margin:0;padding:32px 18px}main{max-width:640px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;margin:16px 0 28px}h1{font-size:28px;margin:6px 0}p{color:#a8b7c2;line-height:1.7}section{border:1px solid #2d373e;border-radius:16px;padding:24px;margin:18px 0;background:#181e23}h2{font-size:16px;margin:0 0 16px}.badge{border:1px solid #397457;color:#8defb4;padding:6px 12px;border-radius:24px;font-size:12px}.usage{display:grid;grid-template-columns:1fr 1fr;gap:24px}.usage small{display:block;color:#a8b7c2;margin-bottom:8px}.usage strong{font-size:20px}.links{display:flex;gap:10px;flex-wrap:wrap}a{color:#9aedba}a.button{background:#94eab2;color:#14291c;border-radius:8px;padding:12px 16px;text-decoration:none;font-weight:600}input,textarea{width:100%;border:1px solid #40525e;background:#101316;color:#eee;border-radius:8px;padding:12px;margin:10px 0;direction:ltr;font:12px ui-monospace,monospace}textarea{height:110px}img{background:white;border-radius:12px;max-width:100%;height:auto}footer{color:#a8b7c2;text-align:center;font-size:12px;margin:28px 0}meter{width:100%;height:16px;margin-top:22px}label{display:block;color:#b7c3cb;font-size:13px}:focus-visible{outline:3px solid #9aebba;outline-offset:3px}.compact main{max-width:480px}.compact section{padding:18px}.compact header{margin-bottom:18px}.compact h1{font-size:24px}@media(max-width:480px){section{padding:18px}.usage{gap:18px}}</style></head><body class="{{if .Compact}}compact{{end}}"><main><header><strong>{{.Site}}</strong><span class="badge">{{.Active}}</span></header><h1>{{.Name}}</h1><p>{{.Protocol}} · {{.Host}}</p>{{if .Announcement}}<section>{{.Announcement}}{{if .AnnouncementURL}} <a href="{{.AnnouncementURL}}">↗</a>{{end}}</section>{{end}}<section><div class="usage"><div><small>{{.UsageLabel}}</small><strong>{{.Used}} / {{.Quota}}</strong></div><div><small>{{.ExpiryLabel}}</small><strong>{{.Expiry}}</strong></div></div>{{if .Limited}}<meter min="0" max="100" value="{{.Percent}}">{{.Percent}}%</meter>{{end}}</section><section><h2>{{.Connect}}</h2><label for="subscription">{{.URLLabel}}</label><input id="subscription" readonly value="{{.URL}}" aria-label="{{.URLLabel}}">{{if .ShowQR}}<p><img width="192" height="192" src="{{.QR}}" alt="{{.QRLabel}}"></p>{{end}}<div class="links">{{if .Link}}<a class="button" href="{{.URL}}?format=base64">Base64</a>{{if .Clash}}<a class="button" href="{{.URL}}?format=clash">Clash / Mihomo</a>{{end}}{{end}}{{if .Profile}}<a class="button" href="{{.URL}}?format=wireguard">WireGuard</a>{{end}}<a class="button" href="{{.URL}}?format=json">JSON</a></div>{{if .ShowURI}}{{if .Link}}<label for="uri">{{.URILabel}}</label><textarea id="uri" readonly>{{.Link}}</textarea>{{end}}{{end}}{{if .Proxy}}<p>{{.ProxyLabel}}</p><pre>{{.Proxy}}</pre>{{end}}{{if .ShowApps}}<p>{{.AppsLabel}}: v2rayNG · Hiddify · Streisand · Mihomo</p>{{end}}</section>{{if .Support}}<p><a href="{{.Support}}">{{.SupportLabel}}</a></p>{{end}}<footer>{{.Footer}}</footer></main></body></html>`))

func (s *Server) portal(w http.ResponseWriter, r *http.Request, c, i, n, cfg Data, link, profile string) {
	url := strings.TrimRight(s.Config.PublicURL, "/") + "/sub/" + str(c, "subscription_token")
	used, limit := num(c, "used_traffic_bytes"), num(c, "traffic_limit_bytes")
	expiry := "No expiry"
	if t, e := timestamp(c, "expires_at"); e == nil {
		expiry = t.UTC().Format("2006-01-02")
	}
	quota := "Unlimited"
	if limit > 0 {
		quota = fmtBytes(limit)
	}
	_, clashErr := clashConfig(c, i, n)
	d := map[string]any{"Locale": str(cfg, "default_locale"), "Direction": "ltr", "Compact": str(cfg, "subscription_template") == "compact", "Site": str(cfg, "site_name"), "Name": str(c, "name"), "Protocol": strings.ToUpper(str(i, "protocol")), "Host": str(n, "public_host"), "Active": "Active", "UsageLabel": "Traffic used", "ExpiryLabel": "Expires", "Used": fmtBytes(used), "Quota": quota, "Expiry": expiry, "Limited": limit > 0, "Percent": min(100, percent(used, limit)), "URL": url, "URLLabel": "Subscription URL", "Connect": "Connection", "QRLabel": "Subscription QR code", "URILabel": "Connection URI", "AppsLabel": "Compatible apps", "SupportLabel": "Contact support", "ShowQR": flag(cfg, "subscription_show_qr"), "ShowApps": flag(cfg, "subscription_show_apps"), "ShowURI": flag(cfg, "subscription_show_connection_uri"), "Link": link, "Profile": profile, "Clash": clashErr == nil, "Support": str(cfg, "support_url"), "Footer": str(cfg, "subscription_footer"), "Announcement": str(cfg, "announcement"), "AnnouncementURL": str(cfg, "announcement_url"), "ProxyLabel": "Proxy account"}
	if str(cfg, "default_locale") == "fa" {
		d["Direction"] = "rtl"
		d["Active"] = "فعال"
		d["UsageLabel"] = "مصرف ترافیک"
		d["ExpiryLabel"] = "تاریخ پایان"
		d["Connect"] = "اتصال"
		d["URLLabel"] = "آدرس اشتراک"
		d["QRLabel"] = "کد اشتراک"
		d["URILabel"] = "لینک اتصال"
		d["AppsLabel"] = "برنامه‌های سازگار"
		d["SupportLabel"] = "تماس با پشتیبانی"
		d["ProxyLabel"] = "اطلاعات پروکسی"
		if limit == 0 {
			d["Quota"] = "نامحدود"
		}
		if expiry == "No expiry" {
			d["Expiry"] = "بدون انقضا"
		}
	}
	if oneOf(str(i, "protocol"), "http", "socks") {
		d["Proxy"] = fmt.Sprintf("Host: %s\nPort: %d\nUsername: %s\nPassword: %s", str(n, "public_host"), num(i, "port"), str(obj(c, "protocol_settings"), "username"), str(c, "credential"))
	}
	if flag(cfg, "subscription_show_qr") {
		png, e := qrcode.Encode(url, qrcode.Medium, 192)
		if e == nil {
			d["QR"] = template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(png))
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method != "HEAD" {
		if e := portalTemplate.Execute(w, d); e != nil {
			s.Logger.Error("subscription render failed", "error", e)
		}
	}
}
