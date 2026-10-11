export type NetworkConfig = Record<string, any>;
export type NetworkEntry = {
  id?: number;
  name: string;
  node: number;
  core: string;
  tag?: string;
  protocol?: string;
  priority?: number;
  enabled: boolean;
  config: NetworkConfig;
};
export const xrayTemplates: Record<string, NetworkConfig> = {
  freedom: { settings: { domainStrategy: "AsIs" } },
  blackhole: { settings: {} },
  vless: {
    settings: {
      vnext: [
        { address: "", port: 443, users: [{ id: "", encryption: "none" }] },
      ],
    },
    streamSettings: {
      network: "tcp",
      security: "tls",
      tlsSettings: { serverName: "" },
    },
  },
  vmess: {
    settings: {
      vnext: [
        { address: "", port: 443, users: [{ id: "", security: "auto" }] },
      ],
    },
  },
  trojan: {
    settings: { servers: [{ address: "", port: 443, password: "" }] },
    streamSettings: {
      network: "tcp",
      security: "tls",
      tlsSettings: { serverName: "" },
    },
  },
  shadowsocks: {
    settings: {
      servers: [
        { address: "", port: 8388, method: "aes-256-gcm", password: "" },
      ],
    },
  },
  socks: { settings: { servers: [{ address: "", port: 1080, users: [] }] } },
  http: { settings: { servers: [{ address: "", port: 8080, users: [] }] } },
  wireguard: {
    settings: {
      secretKey: "",
      address: ["10.0.0.2/32"],
      peers: [
        { publicKey: "", endpoint: "", allowedIPs: ["0.0.0.0/0", "::/0"] },
      ],
    },
  },
  dns: { settings: { address: "1.1.1.1", port: 53, network: "tcp" } },
  loopback: { settings: { inboundTag: "" } },
};
export const singTemplates: Record<string, NetworkConfig> = {
  direct: {},
  selector: { outbounds: ["direct"], default: "direct" },
  urltest: {
    outbounds: ["direct"],
    url: "https://www.gstatic.com/generate_204",
    interval: "3m",
  },
  vless: {
    server: "",
    server_port: 443,
    uuid: "",
    tls: { enabled: true, server_name: "" },
  },
  vmess: { server: "", server_port: 443, uuid: "", security: "auto" },
  trojan: {
    server: "",
    server_port: 443,
    password: "",
    tls: { enabled: true, server_name: "" },
  },
  shadowsocks: {
    server: "",
    server_port: 8388,
    method: "aes-256-gcm",
    password: "",
  },
  hysteria2: {
    server: "",
    server_port: 443,
    password: "",
    tls: { enabled: true, server_name: "" },
  },
  tuic: {
    server: "",
    server_port: 443,
    uuid: "",
    password: "",
    congestion_control: "bbr",
    tls: { enabled: true, server_name: "", alpn: ["h3"] },
  },
  anytls: {
    server: "",
    server_port: 443,
    password: "",
    tls: { enabled: true, server_name: "" },
  },
  socks: { server: "", server_port: 1080, version: "5" },
  http: { server: "", server_port: 8080 },
  ssh: { server: "", server_port: 22, user: "root", password: "" },
};
export function outboundTemplate(
  core: string,
  protocol: string,
): NetworkConfig {
  return structuredClone(
    (core === "xray" ? xrayTemplates : singTemplates)[protocol] || {},
  );
}
export function routingPreset(core: string, preset: string): NetworkConfig {
  const xray = core === "xray",
    block = xray ? { outboundTag: "blocked" } : { action: "reject" };
  if (preset === "private")
    return xray
      ? { ...block, ip: ["geoip:private"] }
      : { ...block, ip_is_private: true };
  if (preset === "bittorrent") return { ...block, protocol: ["bittorrent"] };
  if (preset === "ads" && xray)
    return { ...block, domain: ["geosite:category-ads-all"] };
  if (preset === "https")
    return xray
      ? { outboundTag: "direct", port: "443", network: "tcp" }
      : { action: "route", outbound: "direct", port: [443], network: "tcp" };
  return xray
    ? { outboundTag: "direct" }
    : { action: "route", outbound: "direct" };
}
export function setConfigPath(
  config: NetworkConfig,
  path: (string | number)[],
  value: unknown,
): NetworkConfig {
  const next = structuredClone(config);
  let target = next;
  path.slice(0, -1).forEach((key, i) => {
    if (target[key] == null)
      target[key] = typeof path[i + 1] === "number" ? [] : {};
    target = target[key];
  });
  target[path[path.length - 1]] = value;
  return next;
}
export function configPath(
  config: NetworkConfig,
  path: (string | number)[],
  fallback: any = "",
): any {
  return path.reduce<any>((value, key) => value?.[key], config) ?? fallback;
}
export function parsePorts(text: string): {
  port?: number[];
  port_range?: string[];
} {
  const port: number[] = [],
    port_range: string[] = [];
  for (const value of text.split(/[,\s]+/).filter(Boolean)) {
    if (/^\d+$/.test(value) && +value >= 1 && +value <= 65535)
      port.push(+value);
    else {
      const range = value.match(/^(\d+)[:-](\d+)$/);
      if (!range || +range[1] < 1 || +range[2] > 65535 || +range[1] > +range[2])
        throw Error("Invalid port or range");
      port_range.push(`${+range[1]}:${+range[2]}`);
    }
  }
  return {
    ...(port.length ? { port } : {}),
    ...(port_range.length ? { port_range } : {}),
  };
}

export function needsProtocolSniff(config: NetworkConfig): boolean {
  return (
    [
      "protocol",
      "domain",
      "domain_suffix",
      "domain_keyword",
      "domain_regex",
    ].some((key) =>
      Array.isArray(config[key]) ? config[key].length > 0 : !!config[key],
    ) ||
    (Array.isArray(config.rules) && config.rules.some(needsProtocolSniff))
  );
}
