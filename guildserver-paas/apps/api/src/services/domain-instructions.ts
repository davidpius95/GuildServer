export interface RegistrarInstruction {
  name: string;
  steps: string[];
  notes?: string;
  /** Link to the registrar's own documentation for this kind of record. */
  docUrl?: string;
}

/** Documentation links for each supported registrar's DNS / forwarding guide. */
export const REGISTRAR_DOC_URLS: Record<string, { dns: string; forwarding: string }> = {
  Namecheap: {
    dns: "https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/",
    forwarding: "https://www.namecheap.com/support/knowledgebase/article.aspx/385/2237/how-to-set-up-a-url-redirect-for-a-domain/",
  },
  GoDaddy: {
    dns: "https://www.godaddy.com/help/add-a-cname-record-19236",
    forwarding: "https://www.godaddy.com/help/forward-my-domain-12123",
  },
  Cloudflare: {
    dns: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/",
    forwarding: "https://developers.cloudflare.com/rules/url-forwarding/",
  },
  Porkbun: {
    dns: "https://kb.porkbun.com/article/63-how-to-edit-dns-records",
    forwarding: "https://kb.porkbun.com/article/56-how-to-set-up-url-forwarding",
  },
  "Google Domains / Squarespace": {
    dns: "https://support.squarespace.com/hc/en-us/articles/4404183898253",
    forwarding: "https://support.squarespace.com/hc/en-us/articles/4404183898253",
  },
  "Other registrars": {
    dns: "https://www.cloudflare.com/learning/dns/dns-records/dns-cname-record/",
    forwarding: "https://en.wikipedia.org/wiki/URL_redirection",
  },
};

export interface ForwardingInstructionsResult {
  method: "redirect";
  /** Short one-line summary of the approach. */
  summary: string;
  /** Longer explanation of what is happening and what the user must do. */
  description: string;
  isWildcard: boolean;
  isApex: boolean;
  registrars: RegistrarInstruction[];
  generic: { type: "URL_FORWARD"; from: string; to: string };
}

export function buildForwardingInstructions(input: {
  domain: string;
  target: string;
}): ForwardingInstructionsResult {
  const isWildcard = input.domain.startsWith("*.");
  const cleanDomain = isWildcard ? input.domain.slice(2) : input.domain;
  const parts = cleanDomain.split(".");
  const isApex = parts.length === 2;

  // e.g. input.target = 'https://app-name.guildserver.io'
  // Let's ensure target has https:// prefix
  const targetUrl = input.target.startsWith("http") ? input.target : `https://${input.target}`;

  const hostToConfigure = isWildcard ? "*" : (isApex ? "@" : parts.slice(0, -2).join("."));

  const genericSteps = {
    type: "URL_FORWARD" as const,
    from: input.domain,
    to: targetUrl,
  };

  const registrars = [
    {
      name: "Namecheap",
      steps: [
        "Log in to Namecheap and go to Domain List > Manage.",
        "Select Advanced DNS.",
        "Add a new record: select 'URL Redirect Record'.",
        `Set Host to: \`${hostToConfigure}\``,
        `Set Value to: \`${targetUrl}\``,
        "Set Unmasked (301) for best app compatibility.",
        "Save changes (green checkmark)."
      ],
      notes: "Namecheap URL Redirects usually take ~30 minutes to propagate."
    },
    {
      name: "GoDaddy",
      steps: [
        "Log in to GoDaddy and go to your Domain Portfolio.",
        "Click your domain to access Domain Settings, then click DNS.",
        "Scroll down to 'Forwarding' and click 'Add forwarding'.",
        isApex ? "Select 'Domain' as the type." : `Select 'Subdomain' and enter \`${hostToConfigure}\`.`,
        `Under 'Forward to', select 'https://' and enter \`${targetUrl.replace("https://", "")}\`.`,
        "Set Forward type to 'Permanent (301)'.",
        "Save changes."
      ],
      notes: "GoDaddy forwarding can take a few hours to become active globally."
    },
    {
      name: "Cloudflare",
      steps: [
        "Log in to Cloudflare and select your domain.",
        "Go to Rules > Redirect Rules.",
        "Click 'Create rule' and give it a name.",
        `Set 'If...' to: Custom filter expression. Field: Hostname, Operator: equals, Value: \`${cleanDomain}\`.`,
        isWildcard ? `Also add a condition: Hostname matches \`*.${cleanDomain}\`.` : "",
        `Under 'Then...', set Type to 'Dynamic' and Expression to \`concat("${targetUrl}", http.request.uri.path)\`.`,
        "Set Status Code to '301'.",
        "Deploy the rule."
      ].filter(Boolean),
      notes: "Cloudflare redirect rules are instant and handle HTTPS automatically. Make sure you have a proxied A/CNAME record (even a dummy one pointing to 192.0.2.1) so Cloudflare resolves the domain."
    },
    {
      name: "Porkbun",
      steps: [
        "Log in to Porkbun and click 'Details' on your domain.",
        "Click the 'Edit' icon next to 'URL Forwarding'.",
        `Leave the subdomain field blank if forwarding the root, or enter \`${hostToConfigure}\`.`,
        `Set the Target URL to: \`${targetUrl}\`.`,
        "Set Type to '301 Permanent'.",
        "Click Submit."
      ],
      notes: "Porkbun automatically handles HTTPS generation for URL forwarding within a few minutes."
    },
    {
      name: "Google Domains / Squarespace",
      steps: [
        "Go to your domain dashboard and click 'Website'.",
        "Click 'Forward domain' or 'Add forwarding'.",
        isApex ? "Leave 'Forward from' empty." : `In 'Forward from', enter \`${hostToConfigure}\`.`,
        `In 'Forward to', enter \`${targetUrl}\`.`,
        "Expand Advanced Settings. Choose 'Permanent redirect (301)' and 'Forward path'.",
        "Save."
      ],
      notes: "Squarespace (formerly Google Domains) handles HTTPS forwarding by default."
    }
  ];

  return {
    method: "redirect" as const,
    isWildcard,
    isApex,
    registrars,
    generic: genericSteps,
  };
}

export interface DnsInstructionsResult {
  method: "dns";
  isWildcard: boolean;
  isApex: boolean;
  /** The DNS record the user must create at their registrar. */
  record: { type: "CNAME" | "A"; name: string; value: string };
  registrars: Array<{ name: string; steps: string[]; notes?: string }>;
}

/**
 * Build DNS instructions for a true "vanity" custom domain: the user points a
 * CNAME (subdomain) or A record (apex) at our server, and Traefik then serves
 * the domain directly with its own Let's Encrypt certificate.
 */
export function buildDnsInstructions(input: {
  domain: string;
  /** Canonical app host the CNAME should target, e.g. "myapp.guildserver.io". */
  cnameTarget: string;
  /** Server public IP for apex A records; null if it couldn't be resolved. */
  apexIp: string | null;
}): DnsInstructionsResult {
  const isWildcard = input.domain.startsWith("*.");
  const cleanDomain = isWildcard ? input.domain.slice(2) : input.domain;
  const parts = cleanDomain.split(".");
  const isApex = parts.length === 2;

  // Apex domains can't use CNAME — they need an A record to the server IP.
  // Subdomains (and wildcards) use a CNAME to the canonical app host.
  const useApexARecord = isApex && !isWildcard && !!input.apexIp;

  const host = isWildcard ? "*" : isApex ? "@" : parts.slice(0, -2).join(".");

  const record: DnsInstructionsResult["record"] = useApexARecord
    ? { type: "A", name: host, value: input.apexIp! }
    : { type: "CNAME", name: host, value: input.cnameTarget };

  const recordLine = `Type: \`${record.type}\`, Host/Name: \`${record.name}\`, Value: \`${record.value}\``;

  const registrars = [
    {
      name: "Namecheap",
      steps: [
        "Log in to Namecheap and go to Domain List > Manage.",
        "Select Advanced DNS.",
        `Click 'Add New Record' and create: ${recordLine}.`,
        "Set TTL to Automatic and save (green checkmark).",
      ],
      notes: "Remove any conflicting URL Redirect or parking records for the same host.",
    },
    {
      name: "GoDaddy",
      steps: [
        "Log in to GoDaddy, open your Domain Portfolio, click the domain, then DNS.",
        "Click 'Add' to create a new record.",
        `Create: ${recordLine}.`,
        "Save.",
      ],
      notes: "If GoDaddy shows existing forwarding for this host, delete it first.",
    },
    {
      name: "Cloudflare",
      steps: [
        "Log in to Cloudflare and select your domain.",
        "Go to DNS > Records > Add record.",
        `Create: ${recordLine}.`,
        "Set Proxy status to 'DNS only' (grey cloud) so the certificate can be issued.",
        "Save.",
      ],
      notes: "The grey cloud (DNS only) is required — the orange proxy will break Let's Encrypt validation and domain verification.",
    },
    {
      name: "Porkbun",
      steps: [
        "Log in to Porkbun and click 'Details' on your domain, then 'DNS Records'.",
        `Add a record: ${recordLine}.`,
        "Save.",
      ],
      notes: "Porkbun supports CNAME flattening at the apex if you can't use an A record.",
    },
    {
      name: "Other registrars",
      steps: [
        "Open your domain's DNS / records management page.",
        `Add a new record exactly as: ${recordLine}.`,
        "Save and wait for DNS to propagate (usually minutes, up to ~1 hour).",
      ],
      notes: useApexARecord
        ? undefined
        : isApex
        ? "Apex domains often need an ALIAS/ANAME record instead of CNAME if your registrar doesn't support apex CNAMEs."
        : undefined,
    },
  ];

  return {
    method: "dns",
    isWildcard,
    isApex,
    record,
    registrars,
  };
}
