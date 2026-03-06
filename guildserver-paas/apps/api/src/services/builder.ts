import Docker from "dockerode";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { broadcastToUser } from "../websocket/server";

const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

export type DetectedBuildType = "dockerfile" | "node" | "python" | "go" | "static" | "unknown";

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

/**
 * Detect the build type by looking at files in the project directory
 */
export function detectBuildType(projectDir: string): DetectedBuildType {
  // Check for Dockerfile first
  if (
    fs.existsSync(path.join(projectDir, "Dockerfile")) ||
    fs.existsSync(path.join(projectDir, "dockerfile"))
  ) {
    return "dockerfile";
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
    case "node": {
      // Check if it's a Next.js, Vite/SPA, or plain Node app
      const pkgJsonPath = path.join(projectDir, "package.json");
      let startCmd = "node index.js";
      let buildCmd = "";
      let hasLockfile = "npm";
      let isStaticSPA = false; // Vite, CRA, or other SPA that builds to static files
      let spaBuildDir = "dist"; // Output directory: Vite→dist, CRA→build

      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (fs.existsSync(path.join(projectDir, "yarn.lock"))) hasLockfile = "yarn";
        if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) hasLockfile = "pnpm";

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
          if (pkg.scripts?.start) {
            startCmd = "npm start";
          }
          if (pkg.scripts?.build) {
            buildCmd = "RUN npm run build";
          }
        }
      }

      const installCmd = hasLockfile === "yarn"
        ? "RUN yarn install --frozen-lockfile"
        : hasLockfile === "pnpm"
        ? "RUN npm install -g pnpm && pnpm install --frozen-lockfile"
        : "RUN npm ci || npm install";

      // For static SPAs (Vite, CRA), use multi-stage build: Node for building, nginx for serving
      if (isStaticSPA) {
        return { dockerfile: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json yarn.lock* pnpm-lock.yaml* ./
${installCmd}
COPY . .
RUN npm run build

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

      let installCmd = "";
      if (hasRequirements) {
        installCmd = "COPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt";
      } else if (hasPyproject) {
        installCmd = "COPY pyproject.toml .\nRUN pip install --no-cache-dir .";
      }

      // Detect common entry points
      let entryPoint = "python app.py";
      if (fs.existsSync(path.join(projectDir, "manage.py"))) {
        entryPoint = "python manage.py runserver 0.0.0.0:8000";
      } else if (fs.existsSync(path.join(projectDir, "main.py"))) {
        entryPoint = "python main.py";
      } else if (fs.existsSync(path.join(projectDir, "app.py"))) {
        entryPoint = "python app.py";
      }

      return { dockerfile: `FROM python:3.12-slim
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
 */
export async function buildImage(opts: BuildOptions): Promise<BuildResult> {
  const logs: string[] = [];
  const imageTag = `gs-${opts.appName}:${opts.deploymentId.slice(0, 8)}`;

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
  const detectedType = detectBuildType(opts.localPath);
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
  if (!fs.existsSync(dockerfilePath) && detectedType !== "dockerfile") {
    // Generate a Dockerfile based on detected type
    log(`No Dockerfile found. Generating one for ${detectedType} project...`);
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

    const stream = await docker.buildImage(
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

      docker.modem.followProgress(
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
 */
export async function removeImage(imageTag: string): Promise<void> {
  try {
    const image = docker.getImage(imageTag);
    await image.remove({ force: true });
    logger.debug(`Removed image: ${imageTag}`);
  } catch {
    // Image may not exist
  }
}
