import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOLIFY_UPSTREAM } from "@guildserver/database/dist/seed/service-templates";
import { getServiceTemplateCompose } from "@guildserver/database/dist/seed/service-template-compose";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { slugify } from "../services/compose/normalize";
import {
  deployableCatalogue,
  planTemplateStack,
  TemplateInputError,
  toCatalogueEntry,
} from "../services/templates/catalogue";
import { serviceRouter } from "./service";

function findPublishable(id: string) {
  const template = deployableCatalogue().templates.find((candidate) => candidate.id === id);
  if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
  return template;
}

/** The one-click service catalogue. See services/templates/catalogue.ts. */
export const serviceTemplateRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().max(100).optional(),
          category: z.string().max(100).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      const search = input?.search?.trim().toLowerCase();
      const available = deployableCatalogue().templates;
      const templates = available.filter((template) => {
        if (input?.category && template.category !== input.category) return false;
        if (!search) return true;
        return (
          template.name.toLowerCase().includes(search) ||
          template.description.toLowerCase().includes(search) ||
          template.tags.some((tag) => tag.toLowerCase().includes(search))
        );
      }).map(toCatalogueEntry);

      return {
        templates,
        categories: Array.from(new Set(available.map((t) => t.category))).sort(),
        total: available.length,
        source: { repository: COOLIFY_UPSTREAM.repository, commit: COOLIFY_UPSTREAM.commit, license: COOLIFY_UPSTREAM.license },
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(255) }))
    .query(({ input }) => toCatalogueEntry(findPublishable(input.id))),

  /** Create a stack from a template and, unless `deploy: false`, deploy it. */
  deploy: protectedProcedure
    .input(
      z.object({
        templateId: z.string().min(1).max(255),
        projectId: z.string().uuid(),
        name: z
          .string()
          .trim()
          .min(1)
          .max(63)
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/, "Use letters, numbers, spaces, hyphens and underscores"),
        values: z.record(z.string().max(4096)).default({}),
        deploy: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const template = findPublishable(input.templateId);
      const compose = getServiceTemplateCompose(template.id);
      if (!compose) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `No Compose file is bundled for ${template.name}` });
      }

      const baseDomain = process.env.BASE_DOMAIN || "guildserver.localhost";
      const randomSuffix = crypto.randomBytes(2).toString("hex");
      const baseSlug = slugify(input.name);
      const stackSlug = `${baseSlug}-${randomSuffix}`;
      let plan;
      try {
        plan = planTemplateStack(template, compose, {
          stackSlug,
          baseDomain,
          https: !baseDomain.endsWith("localhost"),
          userValues: input.values,
        });
      } catch (error) {
        if (error instanceof TemplateInputError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }

      // Create and deploy through the stack router itself, so project access,
      // Compose validation and deployment bookkeeping are the same as for a
      // stack a user writes by hand.
      const stacks = serviceRouter.createCaller(ctx);
      const stack = await stacks.create({
        name: input.name,
        serviceName: stackSlug,
        projectId: input.projectId,
        description: template.description.slice(0, 1000),
        composeFile: plan.composeFile,
        environment: plan.environment,
        domains: plan.domains,
        templateId: template.id,
        templateVersion: COOLIFY_UPSTREAM.commit,
      });
      const deployment = input.deploy ? await stacks.deploy({ id: stack.id }) : null;

      return { stackId: stack.id, deploymentId: deployment?.id ?? null, urls: plan.urls, warnings: plan.warnings };
    }),
});
