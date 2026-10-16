package panel

import (
 "net/http/httptest"
 "os"
 "strings"
 "testing"
)

func TestModernSubscriptionPortalHasNativeStatisticsAndSafeMarkup(t *testing.T) {
 server:=&Server{Config:Config{PublicURL:"https://panel.example"}}
 client:=defaults("clients")
 client["name"]="Arman"
 client["subscription_token"]=strings.Repeat("x",32)
 client["credential"]=uuid()
 client["used_traffic_bytes"]=int64(2<<30)
 client["raw_used_traffic_bytes"]=int64(1<<30)
 client["traffic_limit_bytes"]=int64(10<<30)
 inbound:=defaults("inbounds")
 inbound["name"]="Main"
 inbound["protocol"]="vless"
 node:=Data{"public_host":"example.com"}
 cfg:=defaultSettings()
 cfg["default_locale"]="fa"
 cfg["subscription_template"]="default"
 uri:="vless://"+str(client,"credential")+"@example.com:443#Main"
 details:=[]Data{{"name":"Primary","protocol":"vless","node":"Local","host":"example.com","link":uri}}
 render:=func(method string)*httptest.ResponseRecorder{
  w:=httptest.NewRecorder()
  server.portal(w,httptest.NewRequest(method,"/sub/test?format=portal",nil),client,inbound,node,cfg,uri,"",details...)
  return w
 }
 w:=render("GET")
 if w.Code!=200 {t.Fatalf("status %d",w.Code)}
 html:=w.Body.String()
 for _,needle:=range []string{
  "data-portal-version=\"2\"","subscription-modern.css","subscription-modern.js",
  "data-chart-url=\"https://panel.example/sub/","format=stats","traffic-chart",
  "profile-list","profile-search","protocol-filter","copy-all","copy-subscription",
  "data-range=\"90d\"","id=\"qr-dialog\"","portal-language","toggle-theme",
  "2.0 GB","8.0 GB","1.0 GB","Arman","Primary","در حال",
 } {
  if !strings.Contains(html,needle) {t.Fatalf("modern portal missing %q",needle)}
 }
 if file:=os.Getenv("VELORAY_TEST_MODERN_PORTAL_HTML");file!="" {
  if err:=os.WriteFile(file,w.Body.Bytes(),0600);err!=nil{t.Fatal(err)}
 }
 cfg["subscription_show_connection_uri"]=false
 if strings.Contains(render("GET").Body.String(),"profile-list") {t.Fatal("hidden URI surfaced in modern portal")}
 cfg["subscription_show_connection_uri"]=true
 cfg["subscription_show_qr"]=false
 if strings.Contains(render("GET").Body.String(),"qr-trigger"){t.Fatal("disabled QR surfaced")}
 cfg["subscription_show_qr"]=true
 client["name"]="<script>alert(1)</script>"
 if strings.Contains(render("GET").Body.String(),"<script>alert"){t.Fatal("unescaped customer name")}
 if render("HEAD").Body.Len()!=0 {t.Fatal("HEAD must have no body")}
}

func TestSubscriptionRangeValidation(t *testing.T) {
 for _,v:=range []string{"1h","12h","24h","7d","30d","90d",""} {
  d,b,ok:=subscriptionRange(v)
  if !ok||d==""||b==""{t.Fatalf("range %q incorrectly rejected",v)}
 }
 for _,v:=range []string{"100y","' OR 1=1--","day","-1h"} {
  if _,_,ok:=subscriptionRange(v);ok{t.Fatalf("unsafe range accepted %q",v)}
 }
}

func TestModernConnectionScoping(t *testing.T) {
 d:=map[string]any{"URL":"https://example/sub/abc"}
 c:=Data{"traffic_limit_bytes":int64(2),"used_traffic_bytes":int64(10)}
 cfg:=defaultSettings()
 modernPortalData(d,c,cfg,[]Data{
 {"name":"Valid","protocol":"vmess","node":"Local","host":"example.com","link":"vmess://valid"},
 {"name":"Missing","protocol":"tun","node":"Local","host":"example.com","link":""},
 })
 if d["ConnectionCount"]!=2||d["Remaining"]!="0 B" {t.Fatal("unexpected shared accounting",d)}
 if len(d["Connections"].([]Data))!=1 {t.Fatal("non-exportable URI surfaced")}
 if !strings.Contains(d["ChartURL"].(string),"format=stats"){t.Fatal("bad stats URL")}
}
