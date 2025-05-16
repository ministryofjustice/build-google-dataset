export const IS_PROD = process.env.NODE_ENV === "production";
export const MIGRATION_LOG_INPUT_CSV = process.env.MIGRATION_LOG_INPUT_CSV
  ?.length
  ? process.env.MIGRATION_LOG_INPUT_CSV
  : "resources/migration_log_input.csv";
export const OUTPUT_CSV = "build-output/dataset.csv";
export const SCOPES = ["https://www.googleapis.com/auth/drive"];
