export interface ForwardingInstructionsResult {
  isWildcard: boolean;
  isApex: boolean;
  registrars: Array<{ name: string; steps: string[]; notes?: string }>;
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
    isWildcard,
    isApex,
    registrars,
    generic: genericSteps,
  };
}
