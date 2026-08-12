import Docker from "dockerode";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { broadcastToUser } from "../websocket/server";

// Default local Docker client — used when no explicit client is provided.
const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

export type DetectedBuildType =
  | "dockerfile"
  | "fastapi-fullstack"
  | "node"
  | "python"
  | "go"
  | "static"
  | "unknown";

export interface BuildResult {
  imageTag: string;
  buildLogs: string[];
  detectedType: DetectedBuildType;
  containerPort?: number; // The port the container will listen on (from generated Dockerfile)
}

export interface BuildOptions {
  localPath: string;
  appName: string;
  deploymentId: string;
  userId: string;
  buildType?: string; // User-specified build type
  dockerfile?: string; // Custom Dockerfile path
  buildArgs?: Record<string, string>;
  environment?: Record<string, string>;
}

type PackageManager = "npm" | "yarn" | "pnpm";

function readPackageJson(projectDir: string): any {
  const pkgJsonPath = path.join(projectDir, "package.json");
  return fs.existsSync(pkgJsonPath) ? JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) : {};
}

export function detectPackageManager(projectDir: string): PackageManager {
  const pkg = readPackageJson(projectDir);
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.toLowerCase() : "";

  if (declared.startsWith("pnpm")) return "pnpm";
  if (declared.startsWith("yarn")) return "yarn";
  if (declared.startsWith("npm")) return "npm";

  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";

  return "npm";
}

function hasLockfile(projectDir: string, packageManager: PackageManager): boolean {
  if (packageManager === "pnpm") return fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"));
  if (packageManager === "yarn") return fs.existsSync(path.join(projectDir, "yarn.lock"));
  return fs.existsSync(path.join(projectDir, "package-lock.json"));
}

function getInstallCommand(projectDir: string, packageManager: PackageManager): string {
  const locked = hasLockfile(projectDir, packageManager);

  switch (packageManager) {
    case "pnpm":
      return locked ? "RUN pnpm install --frozen-lockfile" : "RUN pnpm install";
    case "yarn":
      return locked ? "RUN yarn install --frozen-lockfile" : "RUN yarn install";
    default:
      return locked ? "RUN npm ci" : "RUN npm install";
  }
}

function getBuildCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm build";
    case "yarn":
      return "yarn build";
    default:
      return "npm run build";
  }
}

function isFastApiFullStackTemplate(projectDir: string): boolean {
  const backendPyprojectPath = path.join(projectDir, "backend", "pyproject.toml");
  const frontendPackagePath = path.join(projectDir, "frontend", "package.json");
  const backendMainPath = path.join(projectDir, "backend", "app", "main.py");

  if (
    !fs.existsSync(backendPyprojectPath) ||
    !fs.existsSync(frontendPackagePath) ||
    !fs.existsSync(backendMainPath)
  ) {
    return false;
  }

  const backendPyproject = fs.readFileSync(backendPyprojectPath, "utf8");
  const backendMain = fs.readFileSync(backendMainPath, "utf8");

  return /fastapi/i.test(backendPyproject) && backendMain.includes("app.frontend(");
}

function commandUsesDevServer(command: string): boolean {
  return /\b(vite|next\s+dev|nuxt\s+dev|remix\s+dev|astro\s+dev)\b/.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function resolveNodeStartCommand(projectDir: string, packageManager: "npm" | "yarn" | "pnpm"): string {
  const pkgJsonPath = path.join(projectDir, "package.json");
  const pkg = fs.existsSync(pkgJsonPath) ? JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) : {};
  const scripts = pkg.scripts || {};
  const runScript = packageManager === "yarn" ? "yarn" : `${packageManager} run`;

  if (scripts.start) {
    return packageManager === "yarn" ? "yarn start" : `${packageManager} start`;
  }

  if (scripts.dev && !commandUsesDevServer(scripts.dev)) {
    return `${runScript} dev`;
  }

  if (typeof pkg.main === "string" && fs.existsSync(path.join(projectDir, pkg.main))) {
    return `node ${shellQuote(pkg.main)}`;
  }

  const commonEntries = [
    "dist/server.js",
    "dist/index.js",
    "server.js",
    "index.js",
    "src/server.js",
    "src/index.js",
    "src/server.ts",
    "src/index.ts",
    "src/app.ts",
    "server.ts",
    "index.ts",
    "app.ts",
  ];

  for (const entry of commonEntries) {
    if (!fs.existsSync(path.join(projectDir, entry))) continue;
    if (entry.endsWith(".ts")) return `npx tsx ${shellQuote(entry)}`;
    return `node ${shellQuote(entry)}`;
  }

  return [
    "echo 'No Node.js start command found.'",
    "echo 'Add a package.json start script, set a main file, or include a common entry such as src/server.ts.'",
    "exit 1",
  ].join(" && ");
}

/**
 * Detect the build type by looking at files in the project directory
 */
export function detectBuildType(projectDir: string, opts: { ignoreDockerfile?: boolean } = {}): DetectedBuildType {
  // Check for Dockerfile first
  if (
    !opts.ignoreDockerfile &&
    (fs.existsSync(path.join(projectDir, "Dockerfile")) ||
      fs.existsSync(path.join(projectDir, "dockerfile")))
  ) {
    return "dockerfile";
  }

  // FastAPI's full-stack template has both a frontend workspace and a backend app.
  // Treat it specially before generic Node detection sees the root package.json.
  if (isFastApiFullStackTemplate(projectDir)) {
    return "fastapi-fullstack";
  }

  // Node.js
  if (fs.existsSync(path.join(projectDir, "package.json"))) {
    return "node";
  }

  // Python
  if (
    fs.existsSync(path.join(projectDir, "requirements.txt")) ||
    fs.existsSync(path.join(projectDir, "pyproject.toml")) ||
    fs.existsSync(path.join(projectDir, "Pipfile"))
  ) {
    return "python";
  }

  // Go
  if (fs.existsSync(path.join(projectDir, "go.mod"))) {
    return "go";
  }

  // Static site (has index.html)
  if (fs.existsSync(path.join(projectDir, "index.html"))) {
    return "static";
  }

  return "unknown";
}

/**
 * Generate a Dockerfile for detected project types
 * Returns the Dockerfile content and the port the container will listen on
 */
function generateDockerfile(buildType: DetectedBuildType, projectDir: string): { dockerfile: string; port: number } {
  switch (buildType) {
    case "fastapi-fullstack": {
      return { dockerfile: `FROM oven/bun:1 AS frontend-build
WORKDIR /app
COPY package.json bun.lock* ./
COPY frontend/package.json frontend/package.json
WORKDIR /app/frontend
RUN bun install
COPY frontend/ /app/frontend/
ARG VITE_API_URL=
RUN bun run build

FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml ./
COPY backend/alembic.ini ./
COPY backend/app ./app
COPY --from=frontend-build /app/backend/app/frontend ./app/frontend
RUN pip install --no-cache-dir .
EXPOSE 8000
CMD ["fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "8000"]
`, port: 8000 };
    }

    case "node": {
      // Check if it's a Next.js, Vite/SPA, or plain Node app
      const pkgJsonPath = path.join(projectDir, "package.json");
      const packageManager = detectPackageManager(projectDir);
      let startCmd = "node index.js";
      let buildCmd = "";
      let isStaticSPA = false; // Vite, CRA, or other SPA that builds to static files
      let spaBuildDir = "dist"; // Output directory: Vite→dist, CRA→build

      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Detect static SPA frameworks (Vite, CRA, etc.) that build to static files
        // These have a build script but no start script (or a start script that just runs dev server)
        const hasVite = !!allDeps["vite"] || !!allDeps["@vitejs/plugin-react"] || !!allDeps["@vitejs/plugin-vue"];
        const hasCRA = !!allDeps["react-scripts"];
        const isDevOnlyStart = pkg.scripts?.start && (
          pkg.scripts.start.includes("vite") && !pkg.scripts.start.includes("preview")
        );

        if ((hasVite || hasCRA) && pkg.scripts?.build && (!pkg.scripts?.start || isDevOnlyStart)) {
          // This is a static SPA — build with Node, serve with nginx
          isStaticSPA = true;
          // CRA outputs to build/, Vite outputs to dist/
          spaBuildDir = hasCRA ? "build" : "dist";
        }

        if (!isStaticSPA) {
          startCmd = resolveNodeStartCommand(projectDir, packageManager);
          if (pkg.scripts?.build) {
            buildCmd = `RUN ${getBuildCommand(packageManager)}`;
          }
        }
      }

      const installCmd = getInstallCommand(projectDir, packageManager);

      // For static SPAs (Vite, CRA), use multi-stage build: Node for building, nginx for serving
      if (isStaticSPA) {
        return { dockerfile: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json yarn.lock* pnpm-lock.yaml* ./
${installCmd}
COPY . .
RUN ${getBuildCommand(packageManager)}

FROM nginx:alpine
COPY --from=builder /app/${spaBuildDir} /usr/share/nginx/html
RUN echo 'server {' > /etc/nginx/conf.d/default.conf && \\
    echo '  listen 80;' >> /etc/nginx/conf.d/default.conf && \\
    echo '  location / {' >> /etc/nginx/conf.d/default.conf && \\
    echo '    root /usr/share/nginx/html;' >> /etc/nginx/conf.d/default.conf && \\
    echo '    try_files $uri $uri/ /index.html;' >> /etc/nginx/conf.d/default.conf && \\
    echo '  }' >> /etc/nginx/conf.d/default.conf && \\
    echo '}' >> /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`, port: 80 };
      }

      return { dockerfile: `FROM node:20-alpine
WORKDIR /app
COPY package*.json yarn.lock* pnpm-lock.yaml* ./
${installCmd}
COPY . .
${buildCmd}
EXPOSE 3000
CMD ["sh", "-c", "${startCmd}"]
`, port: 3000 };
    }

    case "python": {
      const hasRequirements = fs.existsSync(path.join(projectDir, "requirements.txt"));
      const hasPyproject = fs.existsSync(path.join(projectDir, "pyproject.toml"));
      const requirementsText = hasRequirements
        ? fs.readFileSync(path.join(projectDir, "requirements.txt"), "utf8")
        : "";
      const pyprojectText = hasPyproject
        ? fs.readFileSync(path.join(projectDir, "pyproject.toml"), "utf8")
        : "";
      const hasFastApi = /fastapi/i.test(`${requirementsText}\n${pyprojectText}`);

      let installCmd = "";
      if (hasRequirements) {
        installCmd = "COPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt";
      } else if (hasPyproject) {
        installCmd = "COPY . .\nRUN pip install --no-cache-dir .";
      }

      // Detect common entry points
      let entryPoint = "python app.py";
      if (fs.existsSync(path.join(projectDir, "manage.py"))) {
        entryPoint = "python manage.py runserver 0.0.0.0:8000";
      } else if (fs.existsSync(path.join(projectDir, "main.py"))) {
        entryPoint = "python main.py";
      } else if (hasFastApi && fs.existsSync(path.join(projectDir, "app", "main.py"))) {
        entryPoint = "fastapi run app/main.py --host 0.0.0.0 --port 8000";
      } else if (fs.existsSync(path.join(projectDir, "app.py"))) {
        entryPoint = "python app.py";
      }

      return { dockerfile: `FROM python:3.14-slim
WORKDIR /app
${installCmd}
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "${entryPoint}"]
`, port: 8000 };
    }

    case "go": {
      return { dockerfile: `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/main .
EXPOSE 8080
CMD ["./main"]
`, port: 8080 };
    }

    case "static": {
      return { dockerfile: `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`, port: 80 };
    }

    default:
      // Fallback: try to serve as static content
      return { dockerfile: `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`, port: 80 };
  }
}

/**
 * Build a Docker image from a project directory
 *
 * @param opts          Build options.
 * @param dockerClient  Optional remote Docker client. When omitted, builds
 *                      against the local Docker daemon (existing behaviour).
 */
export async function buildImage(
  opts: BuildOptions,
  dockerClient?: Docker,
): Promise<BuildResult> {
  const d = dockerClient || docker;
  const logs: string[] = [];
  // Sanitize app name for Docker image reference format:
  // must be lowercase, only [a-z0-9._-], can't start/end with separator
  const sanitizedName = opts.appName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    || "app";
  const imageTag = `gs-${sanitizedName}:${opts.deploymentId.slice(0, 8)}`;

  const log = (msg: string) => {
    logs.push(msg);
    logger.info(`[build:${opts.appName}] ${msg}`);
    broadcastToUser(opts.userId, {
      type: "deployment_log",
      deploymentId: opts.deploymentId,
      log: msg,
      phase: "build",
    });
  };

  // 1. Detect or use specified build type
  let detectedType = detectBuildType(opts.localPath);
  const defaultDockerfilePath = path.join(opts.localPath, "Dockerfile");
  const hasContextSensitiveDockerfile =
    detectedType === "dockerfile" &&
    fs.existsSync(defaultDockerfilePath) &&
    fs.readFileSync(defaultDockerfilePath, "utf8").includes("--mount=type=") &&
    (fs.existsSync(path.join(opts.localPath, "pyproject.toml")) ||
      fs.existsSync(path.join(opts.localPath, "requirements.txt")));
  if (!opts.dockerfile && hasContextSensitiveDockerfile) {
    detectedType = detectBuildType(opts.localPath, { ignoreDockerfile: true });
    log("Ignoring BuildKit-only Python Dockerfile and generating a portable Dockerfile...");
  }
  const effectiveType = opts.buildType === "dockerfile" && detectedType === "dockerfile"
    ? "dockerfile"
    : opts.buildType && opts.buildType !== "nixpacks"
    ? detectedType
    : detectedType;

  log(`Detected project type: ${detectedType}`);

  // 2. Ensure a Dockerfile exists
  const dockerfilePath = opts.dockerfile
    ? path.join(opts.localPath, opts.dockerfile)
    : path.join(opts.localPath, "Dockerfile");

  let generatedPort: number | undefined;
  if ((hasContextSensitiveDockerfile || !fs.existsSync(dockerfilePath)) && detectedType !== "dockerfile") {
    // Generate a Dockerfile based on detected type
    log(`${hasContextSensitiveDockerfile ? "Replacing context-sensitive Dockerfile" : "No Dockerfile found"}. Generating one for ${detectedType} project...`);
    const generated = generateDockerfile(detectedType, opts.localPath);
    fs.writeFileSync(path.join(opts.localPath, "Dockerfile"), generated.dockerfile);
    generatedPort = generated.port;
    log(`Generated Dockerfile written (container port: ${generatedPort})`);
  }

  // 3. Create .dockerignore if it doesn't exist
  const dockerignorePath = path.join(opts.localPath, ".dockerignore");
  if (!fs.existsSync(dockerignorePath)) {
    const defaultIgnore = `node_modules
.git
.env
.env.*
*.log
.DS_Store
dist
.next
__pycache__
*.pyc
`;
    fs.writeFileSync(dockerignorePath, defaultIgnore);
  }

  // 4. Build the Docker image
  log(`Building Docker image: ${imageTag}...`);

  try {
    const buildArgs: Record<string, string> = { ...opts.buildArgs };

    // Inject environment variables as build args
    if (opts.environment) {
      for (const [key, value] of Object.entries(opts.environment)) {
        buildArgs[key] = value;
      }
    }

    const stream = await d.buildImage(
      {
        context: opts.localPath,
        src: ["."],
      },
      {
        t: imageTag,
        dockerfile: opts.dockerfile || "Dockerfile",
        buildargs: Object.keys(buildArgs).length > 0 ? buildArgs : undefined,
        rm: true, // Remove intermediate containers
      }
    );

    // Follow build progress
    await new Promise<void>((resolve, reject) => {
      let buildError: string | null = null;

      d.modem.followProgress(
        stream,
        (err: Error | null, output: any[]) => {
          if (err) {
            log(`ERROR: Build failed: ${err.message}`);
            reject(err);
          } else if (buildError) {
            log(`ERROR: Build failed: ${buildError}`);
            reject(new Error(`Docker build failed: ${buildError}`));
          } else {
            log("Docker build completed successfully");
            resolve();
          }
        },
        (event: any) => {
          if (event.stream) {
            const line = event.stream.trim();
            if (line) log(line);
          }
          if (event.error) {
            buildError = event.error;
            log(`ERROR: ${event.error}`);
          }
        }
      );
    });

    log(`Image built: ${imageTag}`);

    return {
      imageTag,
      buildLogs: logs,
      detectedType,
      containerPort: generatedPort,
    };
  } catch (error: any) {
    log(`ERROR: Build failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get the default internal port for a detected build type.
 * This matches the EXPOSE directive in the generated Dockerfiles above.
 */
export function getPortForBuildType(buildType: DetectedBuildType): number {
  switch (buildType) {
    case "node":
      return 3000;
    case "fastapi-fullstack":
      return 8000;
    case "python":
      return 8000;
    case "go":
      return 8080;
    case "static":
      return 80;
    case "dockerfile":
      return 0; // User should set containerPort manually; 0 = let detectDefaultPort handle it
    case "unknown":
    default:
      return 0;
  }
}

/**
 * Remove a built image (cleanup)
 *
 * @param imageTag     The image tag to remove.
 * @param dockerClient Optional remote Docker client.
 */
export async function removeImage(
  imageTag: string,
  dockerClient?: Docker,
): Promise<void> {
  const d = dockerClient || docker;
  try {
    const image = d.getImage(imageTag);
    await image.remove({ force: true });
    logger.debug(`Removed image: ${imageTag}`);
  } catch {
    // Image may not exist
  }
}
