import fs from "fs";
import os from "os";
import path from "path";
import { resolveNodeStartCommand } from "../../src/services/builder";

jest.mock("dockerode", () => {
  return jest.fn().mockImplementation(() => ({}));
});

function withTempProject(files: Record<string, string>, testFn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guildserver-builder-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(dir, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    testFn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("resolveNodeStartCommand", () => {
  it("uses start script when present", () => {
    withTempProject(
      {
        "package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
      },
      (dir) => {
        expect(resolveNodeStartCommand(dir, "npm")).toBe("npm start");
      },
    );
  });

  it("uses a safe backend dev script when no start script exists", () => {
    withTempProject(
      {
        "package.json": JSON.stringify({ scripts: { dev: "tsx src/server.ts" } }),
        "src/server.ts": "console.log('ok')",
      },
      (dir) => {
        expect(resolveNodeStartCommand(dir, "pnpm")).toBe("pnpm run dev");
      },
    );
  });

  it("does not use frontend dev server scripts as a production command", () => {
    withTempProject(
      {
        "package.json": JSON.stringify({ scripts: { dev: "vite --host 0.0.0.0" } }),
        "src/server.ts": "console.log('ok')",
      },
      (dir) => {
        expect(resolveNodeStartCommand(dir, "npm")).toBe("npx tsx 'src/server.ts'");
      },
    );
  });

  it("uses package main when present", () => {
    withTempProject(
      {
        "package.json": JSON.stringify({ main: "src/api.js" }),
        "src/api.js": "console.log('ok')",
      },
      (dir) => {
        expect(resolveNodeStartCommand(dir, "yarn")).toBe("node 'src/api.js'");
      },
    );
  });
});
