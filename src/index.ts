import fsPromises from "node:fs/promises";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { GoogleDriveService } from "./googleDriveService";
import { CSVUtils } from "./csvUtils";
import { Notify } from "./notify";
import { S3Utils } from "./s3Utils";
import { FileResult } from "./types/FileResult";
import { GoogleAuthService } from "./googleAuthService";
import { MigrationMapper } from "./migrationMapper";
import {
  IS_PROD,
  MIGRATION_LOG_INPUT_CSV,
  OUTPUT_CSV,
} from "./config";
import { router } from "./upload.router";

const knownErrors = ["The domain administrators have disabled Drive apps."];

const isGaxiosError = (
  error: any,
): error is { errors: { message: string }[] } => {
  return error && typeof error === "object" && error.hasOwnProperty("errors");
};

async function buildDataset(): Promise<void> {
  const authService = new GoogleAuthService();
  const migrationLog = CSVUtils.readMigrationLog();
  const migrationLogService = new MigrationMapper(migrationLog as any);
  const emails = migrationLogService.emails;

  const CHUNK_SIZE = 10_000;
  const CONCURRENCY = 25; // Process 5 users concurrently
  let accumulatedFiles: FileResult[] = [];

  for (let i = 0; i < emails.length; i += CONCURRENCY) {
    const batchEmails = emails.slice(i, i + CONCURRENCY);

    console.time(`Batch ${i / CONCURRENCY + 1} - Fetching Drive files`);

    const batchResults = await Promise.all(
      batchEmails.map(async (email, batchIndex) => {
        const emailIndex = i + batchIndex;

        const identifier = IS_PROD ? `email index ${emailIndex}` : email;

        console.time(`Fetching files for ${identifier}`);

        const driveService = new GoogleDriveService(
          authService.getJwtForUser(email),
        );
        try {
          const userFiles = await driveService.getDriveFiles();
          console.timeEnd(`Fetching files for ${identifier}`);

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
          let allErrorsAreKnown = false;
          // Handle known errors
          if (IS_PROD && isGaxiosError(err)) {
            allErrorsAreKnown = err.errors.every((error) => {
              if (knownErrors.includes(error.message)) {
                console.error(
                  `Error (in known list) for ${identifier}: ${error.message}`,
                );
                return true;
              }
              return false;
            });
          }
          // Handle unknown errors
          if (!allErrorsAreKnown) {
            console.error(`Error processing ${identifier}`, err);
          }
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
  console.log("Initialise.", "Polling S3 for input file has begun...");

  const pollResult = await S3Utils.pollS3File(MIGRATION_LOG_INPUT_CSV);

  // Polling failed if either of the results is false
  if (!pollResult) {
    console.error("Polling failed. Exiting...");

    await Notify.sendEmail("631fc88d-c6f9-4251-aaea-dd3b08713d2a", {
      context: "Polling for input files",
      message:
        "Polling for the input files failed. Please check the S3 bucket.",
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

  // If there is no file at `/tmp/build-output/dataset.csv` then wait 5 mins
  if (!(await fsPromises.stat(`/tmp/${OUTPUT_CSV}`).catch(() => false))) {
    console.log(
      "No dataset.csv file found. Waiting 5 minutes before retrying...",
    );
    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    main();
    return;
  }

  console.log("S3Utils", "Begin upload process to S3...");
  try {
    await S3Utils.uploadToS3();
  } catch (err: any) {
    console.error("Error uploading to S3:", err);
    Notify.sendEmail("631fc88d-c6f9-4251-aaea-dd3b08713d2a", {
      context: "S3 upload process",
      message: "Uploading to S3 failed. Please check logs for full error.",
    });
    return;
  }

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
  main();

  return;
}

// Server
const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.use(express.json());

// Redirect all HTTP traffic to HTTPS
app.use((req: Request, res: Response, next: NextFunction) => {
  if (IS_PROD && !req.secure) {
    res.redirect(`https://${process.env.BASE_HOST}`);
    return;
  }
  next();
});

app.get("/health", (req: Request, res: Response) => {
  res.status(200).send("OK");
});

app.use("/", router);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Start the main function
main().catch((err) => {
  console.error("Script error:", err);
});
