import { z } from "zod";

const envSchema = z.object({
  N8N_QUERY_WEBHOOK_URL: z.string().url(),
  N8N_INGEST_WEBHOOK_URL: z.string().url(),
  N8N_ADMIN_WEBHOOK_URL: z.string().url(),
  N8N_WEBHOOK_SHARED_SECRET: z.string().min(24),
  ADMIN_BASIC_USER: z.string().min(1),
  ADMIN_BASIC_PASS: z.string().min(8),
  SESSION_SECRET: z.string().min(16),
  LOG_RETENTION_DAYS: z.preprocess(
    (value) => {
      if (value === undefined || value === "") {
        return 30;
      }
      return value;
    },
    z.coerce.number().int().min(1).max(3650),
  ),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse({
    N8N_QUERY_WEBHOOK_URL: process.env.N8N_QUERY_WEBHOOK_URL,
    N8N_INGEST_WEBHOOK_URL: process.env.N8N_INGEST_WEBHOOK_URL,
    N8N_ADMIN_WEBHOOK_URL: process.env.N8N_ADMIN_WEBHOOK_URL,
    N8N_WEBHOOK_SHARED_SECRET: process.env.N8N_WEBHOOK_SHARED_SECRET,
    ADMIN_BASIC_USER: process.env.ADMIN_BASIC_USER,
    ADMIN_BASIC_PASS: process.env.ADMIN_BASIC_PASS,
    SESSION_SECRET: process.env.SESSION_SECRET,
    LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
