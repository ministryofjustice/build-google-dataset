export const IS_PROD = process.env.NODE_ENV === "production";
export const GOOGLE_API_CONCURRENCY = process.env.GOOGLE_API_CONCURRENCY
  ?.length
  ? parseInt(process.env.GOOGLE_API_CONCURRENCY as string)
  : 25; // Process 25 users concurrently
export const MIGRATION_LOG_INPUT_CSV = process.env.MIGRATION_LOG_INPUT_CSV
  ?.length
  ? process.env.MIGRATION_LOG_INPUT_CSV
  : "resources/migration_log_input.csv";
export const OUTPUT_CSV = "build-output/dataset.csv";
export const SCOPES = ["https://www.googleapis.com/auth/drive"];
