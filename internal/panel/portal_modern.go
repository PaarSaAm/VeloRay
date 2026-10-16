package panel

import (
 _ "embed"
 "html/template"
 "sort"
 "strings"
)

//go:embed portal_modern.html
var modernPortalHTML string

var modernPortalTemplate = template.Must(template.New("modern-portal").Parse(modernPortalHTML))

// This template uses the existing subscription token and legacy settings.
// No second authorization system, raw-data evaluation or third-party CDN.
func modernPortalData(d map[string]any, c Data, cfg Data, details []Data) {
 d["ChartURL"] = d["URL"].(string) + "?format=stats"
 d["ConnectionCount"] = len(details)
 d["Remaining"] = "Unlimited"
 if limit := num(c,"traffic_limit_bytes");limit>0 {
  used:=num(c,"used_traffic_bytes")
  if used<0 { used=0 }
  if used>=limit { d["Remaining"]="0 B" } else { d["Remaining"]=fmtBytes(limit-used) }
 }
 d["ExpiryISO"] = ""
 if v,err:=timestamp(c,"expires_at");err==nil {
  d["ExpiryISO"]=v.UTC().Format("2006-01-02T15:04:05Z")
 }
 filtered := []Data{}
 protocols := map[string]bool{}
 for _,item:=range details {
  uri:=str(item,"link")
  if uri=="" { continue }
  protocol:=strings.ToUpper(str(item,"protocol"))
  protocols[protocol]=true
  entry:=Data{
   "Name":str(item,"name"),"Protocol":protocol,
   "Node":str(item,"node"),"Host":str(item,"host"),
   "Link":uri,"Search":strings.Join([]string{str(item,"name"),protocol,str(item,"node"),str(item,"host")}," "),
  }
  if flag(cfg,"subscription_show_qr") {
   entry["QR"]=subscriptionQRCode(uri)
  }
  filtered=append(filtered,entry)
 }
 sorted:=make([]string,0,len(protocols))
 for p:=range protocols {sorted=append(sorted,p)}
 sort.Strings(sorted)
 d["Protocols"]=sorted
 d["Connections"]=filtered
}

func subscriptionQRCode(uri string) template.URL {
 data,err:=makeQRCode(uri)
 if err!=nil {return ""}
 return template.URL("data:image/png;base64,"+data)
}
