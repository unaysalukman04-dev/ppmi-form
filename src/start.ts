import { createMiddleware, createStart } from "@tanstack/react-start";
import { env } from "~/server/http";
import { ensureMigrated } from "~/server/migrate";

const migrate = createMiddleware().server(async ({ next }) => {
  await ensureMigrated(env.DB);
  return next();
});

export const startInstance = createStart(() => ({ requestMiddleware: [migrate] }));
