/**
 * Unit tests for the Coolify template parser/translator.
 *
 * Everything here runs against fixtures checked in under
 * tests/fixtures/coolify-templates. Nothing touches the network — the importer
 * fetches from GitHub, but the logic under test is pure.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  classifyVariable,
  parseMetadata,
  parseTemplate,
  stripMetadataHeader,
  translateCompose,
  TemplateParseError,
  type DomainVariable,
  type GeneratedVariable,
} from "../../src/services/templates/coolify-template";

const FIXTURES = join(__dirname, "..", "fixtures", "coolify-templates");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.yaml`), "utf8");
}

function generated(key: string, template: ReturnType<typeof parseTemplate>): GeneratedVariable {
  const variable = template.variables.find((candidate) => candidate.key === key);
  if (!variable || variable.kind !== "generated") {
    throw new Error(`expected ${key} to be a generated variable, got ${variable?.kind ?? "nothing"}`);
  }
  return variable;
}

function domain(key: string, template: ReturnType<typeof parseTemplate>): DomainVariable {
  const variable = template.variables.find((candidate) => candidate.key === key);
  if (!variable || variable.kind !== "domain") {
    throw new Error(`expected ${key} to be a domain variable, got ${variable?.kind ?? "nothing"}`);
  }
  return variable;
}

describe("classifyVariable", () => {
  it("classifies each generator command with the right kind and length", () => {
    const cases: Array<[string, string, number]> = [
      ["SERVICE_PASSWORD_DB", "password", 32],
      ["SERVICE_PASSWORD_64_DB", "password", 64],
      ["SERVICE_PASSWORDWITHSYMBOLS_DB", "password_with_symbols", 32],
      ["SERVICE_PASSWORDWITHSYMBOLS_64_DB", "password_with_symbols", 64],
      ["SERVICE_BASE64_DB", "random_string", 32],
      ["SERVICE_BASE64_32_DB", "random_string", 32],
      ["SERVICE_BASE64_64_DB", "random_string", 64],
      ["SERVICE_BASE64_128_DB", "random_string", 128],
      ["SERVICE_REALBASE64_DB", "base64", 32],
      ["SERVICE_REALBASE64_64_DB", "base64", 64],
      ["SERVICE_REALBASE64_128_DB", "base64", 128],
      ["SERVICE_HEX_32_DB", "hex", 32],
      ["SERVICE_HEX_64_DB", "hex", 64],
      ["SERVICE_HEX_128_DB", "hex", 128],
      ["SERVICE_USER_DB", "username", 16],
      ["SERVICE_LOWERCASEUSER_DB", "username_lowercase", 16],
    ];

    for (const [key, kind, length] of cases) {
      const variable = classifyVariable(key);
      expect(variable).not.toBeNull();
      expect(variable!.kind).toBe("generated");
      const asGenerated = variable as GeneratedVariable;
      expect(asGenerated.generator).toEqual({ kind, length });
    }
  });

  it("prefers the longest matching command so PASSWORD_64 is not read as PASSWORD", () => {
    const variable = classifyVariable("SERVICE_PASSWORD_64_APPWRITE") as GeneratedVariable;
    expect(variable.generator.length).toBe(64);
    expect(variable.identifier).toBe("APPWRITE");
  });

  it("treats SERVICE_-prefixed names outside the command set as ordinary variables", () => {
    // These are real names from the corpus. Reading them as generators would
    // overwrite credentials the user has to supply.
    expect(classifyVariable("SERVICE_ROLE_KEY")).toBeNull();
    expect(classifyVariable("SERVICE_KEY")).toBeNull();
    expect(classifyVariable("SERVICE_OPENAI_API_KEY")).toBeNull();
    expect(classifyVariable("SERVICE_ANTHROPIC_API_KEY")).toBeNull();
    expect(classifyVariable("SERVICE_AUTHOR")).toBeNull();
    expect(classifyVariable("SERVICE_API_URL")).toBeNull();
  });

  it("ignores names without the SERVICE_ prefix", () => {
    expect(classifyVariable("PASSWORD_DB")).toBeNull();
    expect(classifyVariable("DATABASE_URL")).toBeNull();
  });

  it("splits domain variables into service name and port", () => {
    expect(classifyVariable("SERVICE_URL_APP_3000")).toEqual({
      key: "SERVICE_URL_APP_3000",
      kind: "domain",
      format: "url",
      serviceName: "app",
      port: 3000,
    });

    expect(classifyVariable("SERVICE_FQDN_REDIS_CACHE_6379")).toEqual({
      key: "SERVICE_FQDN_REDIS_CACHE_6379",
      kind: "domain",
      format: "fqdn",
      serviceName: "redis_cache",
      port: 6379,
    });
  });

  it("keeps a non-numeric trailing segment as part of the service name", () => {
    expect(classifyVariable("SERVICE_URL_MY_APP")).toEqual({
      key: "SERVICE_URL_MY_APP",
      kind: "domain",
      format: "url",
      serviceName: "my_app",
      port: null,
    });
  });

  it("reports derived Supabase JWTs as unsupported rather than silently generating", () => {
    const variable = classifyVariable("SERVICE_SUPABASEANON_KEY");
    expect(variable).not.toBeNull();
    expect(variable!.kind).toBe("unsupported");
  });
});

describe("parseMetadata", () => {
  it("reads the upstream header block", () => {
    const meta = parseMetadata(fixture("actualbudget"));
    expect(meta).toMatchObject({
      documentation: "https://actualbudget.org/docs/install/docker",
      slogan: "A local-first personal finance app.",
      category: "finance",
      logo: "svgs/actualbudget.png",
      port: 5006,
      ignore: false,
    });
    expect(meta.tags).toContain("budgeting");
    expect(meta.tags).toContain("finance");
  });

  it("collects IMPORTANT notices", () => {
    const meta = parseMetadata(fixture("declaration-forms"));
    expect(meta.notices).toEqual([
      "SOMETHING_PERMANENT cannot be changed after first deployment!",
    ]);
  });

  it("reads the ignore flag", () => {
    expect(parseMetadata(fixture("ignored")).ignore).toBe(true);
  });

  it("stops at the first non-comment line so body comments are not metadata", () => {
    const source = [
      "# slogan: Real slogan.",
      "",
      "services:",
      "  app:",
      "    # slogan: not metadata",
      "    # category: not-metadata",
      "    image: example/app:1.0",
    ].join("\n");

    const meta = parseMetadata(source);
    expect(meta.slogan).toBe("Real slogan.");
    expect(meta.category).toBeNull();
  });

  it("returns empty metadata for a file with no header", () => {
    const meta = parseMetadata("services:\n  app:\n    image: example/app:1.0\n");
    expect(meta.slogan).toBeNull();
    expect(meta.tags).toEqual([]);
    expect(meta.port).toBeNull();
  });

  it("rejects a non-numeric port instead of emitting NaN", () => {
    expect(parseMetadata("# port: not-a-number\n").port).toBeNull();
  });
});

describe("stripMetadataHeader", () => {
  it("removes the header and leaves the Compose body intact", () => {
    const body = stripMetadataHeader(fixture("actualbudget"));
    expect(body.startsWith("services:")).toBe(true);
    expect(body).toContain("actualbudget/actual-server:latest");
    expect(body).not.toContain("# slogan:");
  });
});

describe("translateCompose", () => {
  it("turns a bare declaration into ordinary interpolation under the same name", () => {
    const { compose } = translateCompose("services:\n  app:\n    environment:\n      - SERVICE_URL_APP_3000\n");
    expect(compose).toContain("- SERVICE_URL_APP_3000=${SERVICE_URL_APP_3000}");
  });

  it("appends a declared path to the interpolated URL", () => {
    const { compose } = translateCompose("    environment:\n      - SERVICE_URL_APPWRITE=/console\n");
    expect(compose).toContain("- SERVICE_URL_APPWRITE=${SERVICE_URL_APPWRITE}/console");
  });

  it("leaves references untouched — both $VAR and ${VAR} are already valid Compose", () => {
    const source = [
      "    environment:",
      "      - _APP_DB_PASS=$SERVICE_PASSWORD_MARIADB",
      "      - _APP_DOMAIN=${_APP_DOMAIN:-$SERVICE_FQDN_APPWRITE}",
      "      - _APP_DOMAIN_SITES=${_APP_DOMAIN_SITES:-sites.$SERVICE_FQDN_APPWRITE}",
    ].join("\n");

    const { compose } = translateCompose(source);
    expect(compose).toBe(source);
  });

  it("does not rewrite a non-magic SERVICE_ declaration", () => {
    const source = "    environment:\n      - SERVICE_ROLE_KEY\n";
    expect(translateCompose(source).compose).toBe(source);
  });

  it("collects variables from references as well as declarations", () => {
    const { variables } = translateCompose(
      "    environment:\n      - SERVICE_URL_APP_3000\n      - PW=${SERVICE_PASSWORD_DB}\n",
    );
    expect(variables.map((v) => v.key).sort()).toEqual(["SERVICE_PASSWORD_DB", "SERVICE_URL_APP_3000"]);
  });

  it("deduplicates a variable used many times", () => {
    const { variables } = translateCompose(
      "    environment:\n      - A=${SERVICE_PASSWORD_DB}\n      - B=${SERVICE_PASSWORD_DB}\n",
    );
    expect(variables).toHaveLength(1);
  });

  it("is idempotent — translating twice changes nothing further", () => {
    const source = fixture("declaration-forms");
    const once = translateCompose(stripMetadataHeader(source)).compose;
    expect(translateCompose(once).compose).toBe(once);
  });
});

describe("parseTemplate", () => {
  it("parses a simple single-service template end to end", () => {
    const template = parseTemplate("actualbudget", fixture("actualbudget"));

    expect(template.id).toBe("actualbudget");
    expect(template.name).toBe("Actualbudget");
    expect(template.metadata.port).toBe(5006);
    expect(template.services).toHaveLength(1);
    expect(template.services[0]).toMatchObject({
      name: "actual_server",
      image: "actualbudget/actual-server:latest",
      hasHealthcheck: true,
    });

    const url = domain("SERVICE_URL_ACTUAL_5006", template);
    expect(url.port).toBe(5006);
    expect(template.compose).toContain("- SERVICE_URL_ACTUAL_5006=${SERVICE_URL_ACTUAL_5006}");
  });

  it("classifies every generator command in a multi-generator template", () => {
    const template = parseTemplate("all-generators", fixture("all-generators"));

    expect(generated("SERVICE_PASSWORD_APP", template).generator).toEqual({ kind: "password", length: 32 });
    expect(generated("SERVICE_PASSWORD_64_APP", template).generator).toEqual({ kind: "password", length: 64 });
    expect(generated("SERVICE_REALBASE64_64_APP", template).generator).toEqual({ kind: "base64", length: 64 });
    expect(generated("SERVICE_HEX_32_APP", template).generator).toEqual({ kind: "hex", length: 32 });
    expect(generated("SERVICE_USER_APP", template).generator).toEqual({ kind: "username", length: 16 });

    // The two non-magic names must not appear in the declared set at all.
    const keys = template.variables.map((variable) => variable.key);
    expect(keys).not.toContain("SERVICE_OPENAI_API_KEY");
    expect(keys).not.toContain("SERVICE_ROLE_KEY");
  });

  it("handles map-style and path-suffixed declarations together", () => {
    const template = parseTemplate("declaration-forms", fixture("declaration-forms"));

    expect(template.compose).toContain("- SERVICE_URL_WEB=${SERVICE_URL_WEB}");
    expect(template.compose).toContain("- SERVICE_URL_WEB=${SERVICE_URL_WEB}/console");
    expect(template.compose).toContain("- SERVICE_FQDN_WEB_80=${SERVICE_FQDN_WEB_80}");

    // Map-style entries are already valid interpolation and stay as written.
    expect(template.compose).toContain("SERVICE_URL_API_9000: ${SERVICE_URL_API_9000}");

    expect(domain("SERVICE_URL_API_9000", template)).toMatchObject({ serviceName: "api", port: 9000 });
    expect(template.services.find((s) => s.name === "api")!.ports).toEqual([9000]);
  });

  it("warns and stays unpublishable when a template needs derived JWTs", () => {
    const template = parseTemplate("derived-jwt", fixture("derived-jwt"));
    const unsupported = template.variables.filter((variable) => variable.kind === "unsupported");
    expect(unsupported.map((variable) => variable.key).sort()).toEqual([
      "SERVICE_SUPABASEANON_KEY",
      "SERVICE_SUPABASESERVICE_KEY",
    ]);
    expect(template.warnings.some((warning) => warning.includes("SERVICE_SUPABASEANON_KEY"))).toBe(true);
  });

  it("warns when a domain variable targets a service the file does not define", () => {
    const source = [
      "# slogan: Mismatched domain target.",
      "",
      "services:",
      "  web:",
      "    image: example/web:1.0",
      "    environment:",
      "      - SERVICE_URL_FRONTEND_3000",
    ].join("\n");

    const template = parseTemplate("mismatch", source);
    expect(
      template.warnings.some(
        (warning) => warning.includes("SERVICE_URL_FRONTEND_3000") && warning.includes("frontend"),
      ),
    ).toBe(true);
  });

  it("warns about a service with no image", () => {
    const source = [
      "# slogan: Build-only service.",
      "",
      "services:",
      "  app:",
      "    build: .",
    ].join("\n");

    const template = parseTemplate("build-only", source);
    expect(template.warnings.some((warning) => warning.includes("no image"))).toBe(true);
  });

  it("flags a template upstream marked ignore", () => {
    const template = parseTemplate("ignored", fixture("ignored"));
    expect(template.metadata.ignore).toBe(true);
    expect(template.warnings.some((warning) => warning.includes("ignore"))).toBe(true);
  });

  it("parses a multi-service template sharing generated credentials between services", () => {
    const template = parseTemplate("ghost", fixture("ghost"));

    expect(template.services.map((service) => service.name).sort()).toEqual(["ghost", "mysql"]);

    // The same identifier in two services must resolve to one variable, or the
    // app and its database end up with different passwords.
    expect(template.variables.filter((variable) => variable.key === "SERVICE_PASSWORD_MYSQL")).toHaveLength(1);
    expect(generated("SERVICE_USER_MYSQL", template).identifier).toBe("MYSQL");
    expect(generated("SERVICE_PASSWORD_MYSQLROOT", template).identifier).toBe("MYSQLROOT");

    // Both the port-scoped declaration and the bare reference are declared.
    expect(domain("SERVICE_URL_GHOST_2368", template).port).toBe(2368);
    expect(domain("SERVICE_URL_GHOST", template).port).toBeNull();
  });

  it("reports the upstream YAML defect in langfuse rather than importing it broken", () => {
    // langfuse.yaml (and gramps-web.yaml) merge a sequence anchor into a
    // mapping with `<<:`, which is not valid YAML. These are the only two files
    // in the 371-template corpus that fail to parse, and the importer excludes
    // them with this reason rather than shipping a stack that cannot start.
    expect(() => parseTemplate("langfuse", fixture("langfuse"))).toThrow(/cannot merge mappings/);
  });

  it("keeps complex nested default-value references intact", () => {
    const template = parseTemplate("appwrite-excerpt", fixture("appwrite-excerpt"));
    expect(template.compose).toContain("${_APP_DOMAIN:-$SERVICE_FQDN_APPWRITE}");
    expect(template.compose).toContain("- SERVICE_URL_APPWRITE=${SERVICE_URL_APPWRITE}/");
    expect(generated("SERVICE_PASSWORD_64_APPWRITE", template).generator.length).toBe(64);
  });

  describe("malformed input", () => {
    it("rejects an empty file", () => {
      expect(() => parseTemplate("malformed-empty", fixture("malformed-empty"))).toThrow(TemplateParseError);
    });

    it("rejects a file with metadata but no body", () => {
      expect(() => parseTemplate("malformed-header-only", fixture("malformed-header-only"))).toThrow(
        /no Compose body/,
      );
    });

    it("rejects invalid YAML with a useful message", () => {
      expect(() => parseTemplate("malformed-bad-yaml", fixture("malformed-bad-yaml"))).toThrow(
        /not valid YAML/,
      );
    });

    it("rejects a file with no services mapping", () => {
      expect(() => parseTemplate("malformed-no-services", fixture("malformed-no-services"))).toThrow(
        /no `services` mapping/,
      );
    });

    it("rejects a Compose body that is a scalar rather than a mapping", () => {
      expect(() => parseTemplate("scalar", "# slogan: x\n\njust-a-string\n")).toThrow(TemplateParseError);
    });

    it("rejects an empty services mapping", () => {
      expect(() => parseTemplate("empty-services", "# slogan: x\n\nservices: {}\n")).toThrow(
        /declares no services/,
      );
    });
  });
});
