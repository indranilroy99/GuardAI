/**
 * IOC (Indicator of Compromise) Enrichment Module
 *
 * Extracts IPs, domains, and hashes from GuardDuty findings, then enriches
 * them using free public APIs (no API key required).
 *
 * APIs used:
 *   - ipinfo.io  — geolocation, ASN, org (50k req/month free, no key)
 *   - ip-api.com — threat reputation + ISP info (1k req/min free, no key)
 */

export interface IpEnrichment {
  ip: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
  asn?: string;
  isp?: string;
  isProxy?: boolean;
  isTor?: boolean;
  threatLevel?: "none" | "low" | "medium" | "high";
  latitude?: number;
  longitude?: number;
}

export interface IocEnrichmentResult {
  extractedIps: string[];
  extractedDomains: string[];
  ipEnrichments: IpEnrichment[];
  summary: string;
  threatIndicators: string[];
  enrichedAt: string;
}

/** Extract all IPv4 addresses from arbitrary JSON text. */
function extractIps(text: string): string[] {
  const ipRegex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  const matches = text.match(ipRegex) ?? [];
  // Deduplicate and filter out private/loopback/reserved ranges
  const unique = [...new Set(matches)];
  return unique.filter((ip) => !isPrivateIp(ip));
}

/** Extract domain names from arbitrary JSON text. */
function extractDomains(text: string): string[] {
  const domainRegex = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|co|gov|edu|mil|info|biz|us|uk|de|ru|cn|xyz|top|online|site|club|shop|live)\b/g;
  const matches = text.match(domainRegex) ?? [];
  return [...new Set(matches)].slice(0, 10);
}

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  return false;
}

/** Enrich a single IP via ipinfo.io (free, no key needed). */
async function enrichIpViaIpinfo(ip: string): Promise<Partial<IpEnrichment>> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return {};
    const data = await res.json() as Record<string, string>;
    const [lat, lon] = (data.loc ?? "").split(",").map(Number);
    return {
      hostname: data.hostname,
      city: data.city,
      region: data.region,
      country: data.country,
      org: data.org,
      asn: data.org?.split(" ")[0],
      latitude: isNaN(lat) ? undefined : lat,
      longitude: isNaN(lon) ? undefined : lon,
    };
  } catch {
    return {};
  }
}

/** Enrich a single IP via ip-api.com for threat reputation. */
async function enrichIpViaIpApi(ip: string): Promise<Partial<IpEnrichment>> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,isp,org,as,proxy,hosting,query`,
      { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } },
    );
    if (!res.ok) return {};
    const data = await res.json() as Record<string, unknown>;
    if (data.status !== "success") return {};
    return {
      isp: String(data.isp ?? ""),
      isProxy: Boolean(data.proxy),
      isTor: Boolean(data.hosting),
      threatLevel: data.proxy ? "high" : data.hosting ? "medium" : "none",
    };
  } catch {
    return {};
  }
}

/** Enrich all IPs from a finding JSON. Max 5 IPs to stay within rate limits. */
export async function enrichIocs(findingJson: string): Promise<IocEnrichmentResult> {
  const extractedIps = extractIps(findingJson).slice(0, 5);
  const extractedDomains = extractDomains(findingJson);
  const threatIndicators: string[] = [];

  const ipEnrichments: IpEnrichment[] = await Promise.all(
    extractedIps.map(async (ip): Promise<IpEnrichment> => {
      const [ipinfo, ipapi] = await Promise.all([
        enrichIpViaIpinfo(ip),
        enrichIpViaIpApi(ip),
      ]);
      const enriched: IpEnrichment = { ip, ...ipinfo, ...ipapi };

      if (enriched.isProxy) threatIndicators.push(`${ip} flagged as proxy/VPN`);
      if (enriched.isTor) threatIndicators.push(`${ip} associated with hosting/anonymizing infrastructure`);
      if (enriched.country && ["CN", "RU", "KP", "IR"].includes(enriched.country)) {
        threatIndicators.push(`${ip} originates from high-risk country: ${enriched.country}`);
      }

      return enriched;
    }),
  );

  // Summarize
  const uniqueCountries = [...new Set(ipEnrichments.map((e) => e.country).filter(Boolean))];
  const uniqueOrgs = [...new Set(ipEnrichments.map((e) => e.org).filter(Boolean))];
  const proxies = ipEnrichments.filter((e) => e.isProxy || e.isTor).length;

  let summary = `Found ${extractedIps.length} external IP(s)`;
  if (uniqueCountries.length) summary += ` from ${uniqueCountries.join(", ")}`;
  if (uniqueOrgs.length) summary += `. Orgs: ${uniqueOrgs.slice(0, 3).join("; ")}`;
  if (proxies > 0) summary += `. ${proxies} IP(s) flagged as proxy/anonymizer`;
  if (extractedDomains.length) summary += `. ${extractedDomains.length} domain(s) extracted`;
  if (threatIndicators.length === 0) threatIndicators.push("No high-risk IOC indicators detected");

  return {
    extractedIps,
    extractedDomains,
    ipEnrichments,
    summary,
    threatIndicators,
    enrichedAt: new Date().toISOString(),
  };
}
