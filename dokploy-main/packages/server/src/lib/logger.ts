import pino from "pino";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const isDev = process.env.NODE_ENV !== "production";

export const logger = isDev
	? pino({
			transport: {
				target: _require.resolve("pino-pretty"),
				options: {
					colorize: true,
					levelFirst: false,
				},
			},
		})
	: pino();
