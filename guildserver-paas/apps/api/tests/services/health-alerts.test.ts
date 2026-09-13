import { checkApplicationHealth, alertWindowKey } from "../../src/services/health-alerts";

jest.mock("../../src/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function databaseWith(rows: any[]) {
  return { query: { applications: { findMany: jest.fn().mockResolvedValue(rows) } } } as any;
}

const app = (over: any = {}) => ({
  id: "app-1",
  name: "checkout",
  project: { organizationId: "org-1" },
  ...over,
});

describe("checkApplicationHealth", () => {
  it("notifies the owning organization about a restarting application", async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const raised = await checkApplicationHealth({
      database: databaseWith([app()]),
      notify,
      now: () => new Date("2026-09-13T17:41:00Z"),
      appUrl: "https://guild-technologies.com",
    });

    expect(raised).toBe(1);
    expect(notify).toHaveBeenCalledWith("org-1", "application_unhealthy", {
      appName: "checkout",
      logsUrl: "https://guild-technologies.com/dashboard/applications/app-1",
      dedupeKey: "app-1:2026-09-13T17:00:00.000Z",
    });
  });

  it("uses one dedupe key per hour, so a flapping container is not a pager storm", () => {
    const early = alertWindowKey("app-1", new Date("2026-09-13T17:01:00Z"));
    const late = alertWindowKey("app-1", new Date("2026-09-13T17:59:00Z"));
    const nextHour = alertWindowKey("app-1", new Date("2026-09-13T18:00:00Z"));

    expect(early).toBe(late);
    expect(nextHour).not.toBe(early);
  });

  it("keeps going when one organization's notification fails", async () => {
    const notify = jest
      .fn()
      .mockRejectedValueOnce(new Error("channel down"))
      .mockResolvedValueOnce(undefined);

    const raised = await checkApplicationHealth({
      database: databaseWith([app(), app({ id: "app-2", project: { organizationId: "org-2" } })]),
      notify,
    });

    expect(raised).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("skips an application that has no organization rather than throwing", async () => {
    const notify = jest.fn();
    const raised = await checkApplicationHealth({
      database: databaseWith([app({ project: null })]),
      notify,
    });

    expect(raised).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("raises nothing when every container is healthy", async () => {
    const notify = jest.fn();
    expect(await checkApplicationHealth({ database: databaseWith([]), notify })).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
