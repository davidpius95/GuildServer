/**
 * Unit tests for the pure logic inside scripts/verify-templates.ts.
 *
 * The gate itself needs a scratch Docker daemon and does not run here. What is
 * testable without one is the part that decides WHAT would be deployed, and
 * that is worth pinning down: a bug that quietly ignores a bind mount or a
 * `build:` would let a template "pass" without running the code it claims to.
 */

import {
  isGateEligible,
  planServices,
  startOrder,
  UnsupportedComposeFeature,
} from "../../src/services/templates/compose-plan";

const compose = (body: string) => `services:\n${body}`;

describe("planServices", () => {
  it("plans a simple service", () => {
    const [service] = planServices(
      compose("  app:\n    image: example/app:1\n    environment:\n      - A=1\n"),
    );
    expect(service).toMatchObject({ name: "app", image: "example/app:1", env: ["A=1"] });
  });

  it("accepts map-style environment as well as list-style", () => {
    const [service] = planServices(compose("  app:\n    image: e/a:1\n    environment:\n      A: '1'\n"));
    expect(service.env).toEqual(["A=1"]);
  });

  it("maps named volumes to source and target", () => {
    const [service] = planServices(
      compose("  app:\n    image: e/a:1\n    volumes:\n      - data:/var/lib/data\n"),
    );
    expect(service.volumes).toEqual([{ source: "data", target: "/var/lib/data" }]);
  });

  it("refuses a bind mount rather than silently reaching onto the host", () => {
    expect(() =>
      planServices(compose("  app:\n    image: e/a:1\n    volumes:\n      - ./local:/data\n")),
    ).toThrow(UnsupportedComposeFeature);

    expect(() =>
      planServices(compose("  app:\n    image: e/a:1\n    volumes:\n      - /var/run/docker.sock:/x\n")),
    ).toThrow(/bind-mounts host path/);
  });

  it("refuses a service with no image, such as a build-only service", () => {
    expect(() => planServices(compose("  app:\n    build: .\n"))).toThrow(/unsupported Compose key \"build\"/);
  });

  it("refuses any Compose key it cannot honour, instead of ignoring it", () => {
    // Silently dropping `deploy` would let a template pass without the resource
    // limits or replica count it asks for.
    expect(() => planServices(compose("  app:\n    image: e/a:1\n    deploy:\n      replicas: 3\n"))).toThrow(
      /unsupported Compose key \"deploy\"/,
    );
  });

  it("reads depends_on in both list and map form", () => {
    const list = planServices(
      compose("  app:\n    image: e/a:1\n    depends_on:\n      - db\n  db:\n    image: e/d:1\n"),
    );
    expect(list.find((service) => service.name === "app")!.dependsOn).toEqual(["db"]);

    const map = planServices(
      compose(
        "  app:\n    image: e/a:1\n    depends_on:\n      db:\n        condition: service_healthy\n  db:\n    image: e/d:1\n",
      ),
    );
    expect(map.find((service) => service.name === "app")!.dependsOn).toEqual(["db"]);
  });

  it("rejects a body with no services", () => {
    expect(() => planServices("volumes:\n  data:\n")).toThrow(UnsupportedComposeFeature);
  });
});

describe("startOrder", () => {
  const service = (name: string, dependsOn: string[] = []) =>
    ({ name, dependsOn }) as Parameters<typeof startOrder>[0][number];

  it("starts a dependency before its dependent", () => {
    const ordered = startOrder([service("app", ["db"]), service("db")]);
    expect(ordered.map((entry) => entry.name)).toEqual(["db", "app"]);
  });

  it("handles a chain", () => {
    const ordered = startOrder([service("web", ["api"]), service("api", ["db"]), service("db")]);
    expect(ordered.map((entry) => entry.name)).toEqual(["db", "api", "web"]);
  });

  it("does not hang or drop services on a dependency cycle", () => {
    const ordered = startOrder([service("a", ["b"]), service("b", ["a"])]);
    expect(ordered.map((entry) => entry.name).sort()).toEqual(["a", "b"]);
  });

  it("ignores a dependency on a service that is not defined", () => {
    const ordered = startOrder([service("app", ["missing"])]);
    expect(ordered.map((entry) => entry.name)).toEqual(["app"]);
  });
});

describe("isGateEligible", () => {
  const template = (overrides: Record<string, unknown>) =>
    ({ id: "t", warnings: [], variables: [], ...overrides }) as Parameters<typeof isGateEligible>[0];

  it("excludes a template that already has warnings", () => {
    expect(isGateEligible(template({ id: "bad", warnings: ["something"] }))).toBe(false);
  });

  it("excludes a template needing variables the platform cannot generate", () => {
    // Real case: supabase needs JWTs signed from another generated value.
    expect(
      isGateEligible(
        template({ id: "supabase", variables: [{ kind: "unsupported" }] }),
      ),
    ).toBe(false);
  });

  it("keeps a clean template", () => {
    expect(isGateEligible(template({ id: "good", variables: [{ kind: "generated" }] }))).toBe(true);
  });
});

describe("Coolify extensions in the plan", () => {
  it("treats exclude_from_hc as a one-shot task rather than a crash", () => {
    // Real case: formbricks runs `mc mb` to create a storage bucket and stops.
    // Requiring it to stay running would fail a template that works.
    const [service] = planServices(
      compose('  init:\n    image: e/mc:1\n    restart: "no"\n    exclude_from_hc: true\n'),
    );
    expect(service.oneShot).toBe(true);
  });

  it("treats restart: no as one-shot even without exclude_from_hc", () => {
    const [service] = planServices(compose('  init:\n    image: e/mc:1\n    restart: "no"\n'));
    expect(service.oneShot).toBe(true);
  });

  it("does not mark an ordinary service one-shot", () => {
    const [service] = planServices(compose("  app:\n    image: e/a:1\n    restart: always\n"));
    expect(service.oneShot).toBe(false);
  });

  it("keeps container_name as an alias so intra-stack DNS still resolves", () => {
    const [service] = planServices(compose("  app:\n    image: e/a:1\n    container_name: my-app\n"));
    expect(service.alias).toBe("my-app");
  });

  it("names an anonymous volume so cleanup can find it", () => {
    // An unlabelled anonymous volume would survive sandbox teardown.
    const [service] = planServices(compose("  app:\n    image: e/a:1\n    volumes:\n      - /data\n"));
    expect(service.volumes).toEqual([{ source: "anon-0", target: "/data", anonymous: true }]);
  });
});
