import { readFileSync } from "fs";
import { join } from "path";

import { parseTemplate } from "../../src/services/templates/coolify-template";
import {
  generateValue,
  interpolateCompose,
  materializeVariables,
  UnsupportedVariableError,
} from "../../src/services/templates/materialize";

const FIXTURES = join(__dirname, "..", "fixtures", "coolify-templates");
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.yaml`), "utf8");

const resolveDomain = () => "https://example.test";

describe("generateValue", () => {
  it("produces the requested length for each character-count generator", () => {
    expect(generateValue({ kind: "password", length: 32 })).toHaveLength(32);
    expect(generateValue({ kind: "password", length: 64 })).toHaveLength(64);
    expect(generateValue({ kind: "random_string", length: 128 })).toHaveLength(128);
    expect(generateValue({ kind: "username", length: 16 })).toHaveLength(16);
    expect(generateValue({ kind: "hex", length: 64 })).toHaveLength(64);
  });

  it("keeps passwords free of characters that need shell or YAML quoting", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateValue({ kind: "password", length: 64 })).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("emits real base64 for base64 generators, sized in bytes not characters", () => {
    const value = generateValue({ kind: "base64", length: 64 });
    expect(value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(value, "base64")).toHaveLength(64);
  });

  it("emits lowercase hex", () => {
    expect(generateValue({ kind: "hex", length: 32 })).toMatch(/^[0-9a-f]{32}$/);
  });

  it("lowercases usernames when asked", () => {
    expect(generateValue({ kind: "username_lowercase", length: 16 })).toMatch(/^[a-z0-9]{16}$/);
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateValue({ kind: "password", length: 32 }));
    expect(seen.size).toBe(200);
  });

  it("samples the alphabet without modulo bias", () => {
    // Rejection sampling should leave no character meaningfully likelier than
    // another. With 62 characters and 62k samples, ~1000 each; a modulo-biased
    // generator puts the first 8 about 1.6% high, which this window catches.
    const counts = new Map<string, number>();
    for (const char of generateValue({ kind: "password", length: 62_000 })) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});

describe("materializeVariables", () => {
  it("gives every declared variable a value", () => {
    const template = parseTemplate("all-generators", fixture("all-generators"));
    const env = materializeVariables(template.variables, { resolveDomain });

    for (const variable of template.variables) {
      expect(env[variable.key]).toBeDefined();
      expect(env[variable.key]).not.toBe("");
    }
  });

  it("shares one value between services using the same identifier", () => {
    // Ghost's mysql service sets MYSQL_PASSWORD from SERVICE_PASSWORD_MYSQL and
    // the ghost service connects with the same variable. Two values and the
    // stack deadlocks on first boot.
    const template = parseTemplate("ghost", fixture("ghost"));
    const env = materializeVariables(template.variables, { resolveDomain });

    expect(env.SERVICE_PASSWORD_MYSQL).toBeDefined();
    expect(env.SERVICE_PASSWORD_MYSQLROOT).toBeDefined();
    // Same identifier family, different identifier — must NOT collide.
    expect(env.SERVICE_PASSWORD_MYSQL).not.toBe(env.SERVICE_PASSWORD_MYSQLROOT);
  });

  it("does not give a username and a password the same value despite a shared identifier", () => {
    const template = parseTemplate("ghost", fixture("ghost"));
    const env = materializeVariables(template.variables, { resolveDomain });
    expect(env.SERVICE_USER_MYSQL).not.toBe(env.SERVICE_PASSWORD_MYSQL);
  });

  it("preserves existing values so a redeploy does not rotate live secrets", () => {
    const template = parseTemplate("ghost", fixture("ghost"));
    const first = materializeVariables(template.variables, { resolveDomain });
    const second = materializeVariables(template.variables, { resolveDomain, existing: first });
    expect(second).toEqual(first);
  });

  it("refuses a template needing variables it cannot generate", () => {
    const template = parseTemplate("derived-jwt", fixture("derived-jwt"));
    expect(() => materializeVariables(template.variables, { resolveDomain })).toThrow(
      UnsupportedVariableError,
    );
  });

  it("routes domain variables through the caller's resolver", () => {
    const template = parseTemplate("actualbudget", fixture("actualbudget"));
    const env = materializeVariables(template.variables, {
      resolveDomain: (variable) => `http://${variable.targetService}:${variable.port}`,
    });
    expect(env.SERVICE_URL_ACTUAL_5006).toBe("http://actual_server:5006");
  });
});

describe("interpolateCompose", () => {
  it("substitutes both ${VAR} and $VAR", () => {
    const { compose } = interpolateCompose("a=${A} b=$B", { A: "1", B: "2" });
    expect(compose).toBe("a=1 b=2");
  });

  it("uses :- default when unset or empty", () => {
    expect(interpolateCompose("${A:-fallback}", {}).compose).toBe("fallback");
    expect(interpolateCompose("${A:-fallback}", { A: "" }).compose).toBe("fallback");
    expect(interpolateCompose("${A:-fallback}", { A: "set" }).compose).toBe("set");
  });

  it("uses - default only when unset, keeping a deliberately empty value", () => {
    expect(interpolateCompose("${A-fallback}", {}).compose).toBe("fallback");
    expect(interpolateCompose("${A-fallback}", { A: "" }).compose).toBe("");
  });

  it("resolves a variable referenced inside another's default", () => {
    // Real shape from appwrite: ${_APP_DOMAIN:-$SERVICE_FQDN_APPWRITE}
    const { compose } = interpolateCompose("${_APP_DOMAIN:-$SERVICE_FQDN_APPWRITE}", {
      SERVICE_FQDN_APPWRITE: "apps.example.test",
    });
    expect(compose).toBe("apps.example.test");
  });

  it("keeps a literal prefix on a defaulted reference", () => {
    const { compose } = interpolateCompose("${X:-sites.$SERVICE_FQDN_APPWRITE}", {
      SERVICE_FQDN_APPWRITE: "apps.example.test",
    });
    expect(compose).toBe("sites.apps.example.test");
  });

  it("honours $$ as an escaped literal dollar", () => {
    const { compose } = interpolateCompose("cost=$$5 and $${NOT_A_VAR}", {});
    expect(compose).toBe("cost=$5 and ${NOT_A_VAR}");
  });

  it("reports a missing variable instead of silently emitting an empty string", () => {
    // An unresolved SERVICE_PASSWORD_* is a database with no password, so this
    // must never pass quietly.
    const { missing } = interpolateCompose("PASSWORD=${SERVICE_PASSWORD_DB}", {});
    expect(missing).toEqual(["SERVICE_PASSWORD_DB"]);
  });

  it("does not report a variable that has a default", () => {
    expect(interpolateCompose("${A:-x}", {}).missing).toEqual([]);
  });

  it("leaves no magic variable unresolved for a materialized template", () => {
    const template = parseTemplate("ghost", fixture("ghost"));
    const env = materializeVariables(template.variables, { resolveDomain });
    const { compose, missing } = interpolateCompose(template.compose, env);

    // Whatever is still missing must be a user-supplied variable the template
    // declares — never a magic one, which would mean the translation dropped a
    // secret on the floor.
    const declared = new Set(template.userVariables.map((variable) => variable.key));
    for (const name of missing) {
      expect(name.startsWith("SERVICE_")).toBe(false);
      expect(declared.has(name)).toBe(true);
    }

    expect(compose).not.toContain("SERVICE_PASSWORD_MYSQL");
    expect(compose).toContain(env.SERVICE_PASSWORD_MYSQL);
  });

  it("resolves cleanly once the declared required user variables are supplied", () => {
    const template = parseTemplate("ghost", fixture("ghost"));
    const supplied: Record<string, string> = {};
    for (const variable of template.userVariables) {
      if (variable.required) supplied[variable.key] = "supplied";
    }
    const env = materializeVariables(template.variables, {
      resolveDomain,
      userVariables: template.userVariables,
      existing: supplied,
    });
    expect(interpolateCompose(template.compose, env).missing).toEqual([]);
  });

  it("pins a default so every reference site agrees on the value", () => {
    // Ghost writes ${MYSQL_DATABASE-ghost} in one service and bare
    // ${MYSQL_DATABASE} in another. Left to per-site interpolation the app gets
    // "ghost" and the database server gets "", and Ghost cannot find its schema.
    const template = parseTemplate("ghost", fixture("ghost"));
    const env = materializeVariables(template.variables, {
      resolveDomain,
      userVariables: template.userVariables,
    });
    expect(env.MYSQL_DATABASE).toBe("ghost");

    const { compose } = interpolateCompose(template.compose, env);
    const databases = [...compose.matchAll(/database(?:__connection__database|)=(\S*)/gi)].map((m) => m[1]);
    expect(new Set(databases.filter(Boolean))).toEqual(new Set(["ghost"]));
  });

  it("lets a supplied value override the template default", () => {
    const template = parseTemplate("ghost", fixture("ghost"));
    const env = materializeVariables(template.variables, {
      resolveDomain,
      userVariables: template.userVariables,
      existing: { MYSQL_DATABASE: "custom" },
    });
    expect(env.MYSQL_DATABASE).toBe("custom");
  });
});
