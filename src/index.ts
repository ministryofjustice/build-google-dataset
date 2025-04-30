import fsPromises from "node:fs/promises";
import { GoogleDriveService } from "./googleDriveService";
import { CSVUtils } from "./csvUtils";
import { Notify } from "./notify";
import { S3Utils } from "./s3Utils";
import { FileResult } from "./types/FileResult";
import { GoogleAuthService } from "./googleAuthService";
import { MigrationMapper } from "./migrationMapper";
import { EMAIL_INPUT_CSV, MIGRATION_LOG_INPUT_CSV, OUTPUT_CSV } from "./config";

async function buildDataset(): Promise<void> {
  const authService = new GoogleAuthService();
  const emails = CSVUtils.readEmailAddresses();
  const migrationLog = CSVUtils.readMigrationLog();
  const migrationLogService = new MigrationMapper(migrationLog as any);

  const CHUNK_SIZE = 10_000;
  const CONCURRENCY = 25; // Process 5 users concurrently
  let accumulatedFiles: FileResult[] = [];

  for (let i = 0; i < emails.length; i += CONCURRENCY) {
    const batchEmails = emails.slice(i, i + CONCURRENCY);

    console.time(`Batch ${i / CONCURRENCY + 1} - Fetching Drive files`);

    const batchResults = await Promise.all(
      batchEmails.map(async (email) => {
        console.time(`Fetching files for ${email}`);

        const driveService = new GoogleDriveService(
          authService.getJwtForUser(email),
        );
        try {
          const userFiles = await driveService.getDriveFiles();
          console.timeEnd(`Fetching files for ${email}`);

          return userFiles.map((file) => {
            const migrationEntry = migrationLogService.getEntry(
              email,
              file.googlePath,
            );
            if (migrationEntry) {
              const { DestinationLocation, DestinationType, MicrosoftPath } =
                migrationEntry;
              return {
                ...file,
                destinationLocation: DestinationLocation,
                destinationType: DestinationType,
                microsoftPath: MicrosoftPath,
              };
            }

            return file;
          });
        } catch (err) {
          console.error(`Error processing ${email}`, err);
          return [];
        }
      }),
    );

    console.timeEnd(`Batch ${i / CONCURRENCY + 1} - Fetching Drive files`);

    console.time(`Batch ${i / CONCURRENCY + 1} - Data Processing`);
    // Flatten and add the entire batch at once
    accumulatedFiles.push(...batchResults.flat());

    // Write in large chunks instead of file-by-file
    if (accumulatedFiles.length >= CHUNK_SIZE) {
      CSVUtils.writeOutputCsv(accumulatedFiles, { append: true });
      accumulatedFiles.length = 0; // Clear the array
    }

    console.timeEnd(`Batch ${i / CONCURRENCY + 1} - Data Processing`);
  }

  // Write any remaining files after processing all users
  if (accumulatedFiles.length > 0) {
    CSVUtils.writeOutputCsv(accumulatedFiles, { append: true });
  }
}

async function main(): Promise<void> {
  console.log("Initialise.", "Polling S3 for input files has begun...");
  const pollResults = await Promise.all([
    S3Utils.pollS3File(EMAIL_INPUT_CSV),
    S3Utils.pollS3File(MIGRATION_LOG_INPUT_CSV),
  ]);

  // Polling failed if either of the results is false
  if (pollResults.some((result) => !result)) {
    console.error("Polling failed. Exiting...");

    await Notify.sendEmail("631fc88d-c6f9-4251-aaea-dd3b08713d2a", {
      context: "Polling for input files",
      message: "Polling for the input files failed. Please check the S3 bucket."
    });

    return;
  }

  // Download and save files from S3
  console.log("S3Utils", "Begin download process from S3...");
  await S3Utils.pullResourcesFromS3();

  // Delete the `/tmp/build-output/dataset.csv` file if it exists
  try {
    await fsPromises.unlink(`/tmp/${OUTPUT_CSV}`);
    console.log("Deleted existing output CSV file.");
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error("Error deleting existing output CSV file:", err);
    } else {
      console.log("No existing output CSV file to delete.");
    }
  }

  // Ensure the folder `/tmp/build-output` exists
  await fsPromises.mkdir("/tmp/build-output", { recursive: true });
  console.log("Created /tmp/build-output directory.");

  console.log("Running build dataset...");
  await buildDataset();

  console.log("S3Utils", "Begin upload process to S3...");
  await S3Utils.uploadToS3();

  // Remove local files
  await fsPromises.rm("/tmp/resources", { recursive: true, force: true });
  console.log("Removed local resources directory.");
  await fsPromises.rm(`/tmp/build-output`, { recursive: true, force: true });
  console.log("Removed local build-output directory.");
  
  // Move S3 resource files to a completed directory
  await S3Utils.moveS3ResourceFilesToCompleted();
  console.log("Moved S3 resource files to completed directory.");

  // Send success email notification
  await Notify.sendEmail("11ff2de6-9d50-431e-91f7-44f06a261261");

  // If we've made it here, we have successfully run, start polling again for updates.
  await main();

  return;
}

main().catch((err) => {
  console.error("Script error:", err);
});
