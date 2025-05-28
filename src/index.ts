import fsPromises from "node:fs/promises";
import { createHash } from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { PromisePool } from "@supercharge/promise-pool";
import { listParams, GoogleDriveService } from "./googleDriveService";
import { CSVUtils } from "./csvUtils";
import { Notify } from "./notify";
import { CacheUtils } from "./cacheUtils";
import { S3Utils } from "./s3Utils";
import { FileResult } from "./types/FileResult";
import { GoogleAuthService } from "./googleAuthService";
import { MigrationMapper } from "./migrationMapper";
import {
  IS_PROD,
  GOOGLE_API_CONCURRENCY,
  MIGRATION_LOG_INPUT_CSV,
  OUTPUT_CSV,
} from "./config";
import { router } from "./upload.router";

const knownErrors = ["The domain administrators have disabled Drive apps."];

type DatasetSummary = {
  processedCount: number;
  csvEntryCount: number;
  csvCollisionCount: number;
  mapCount: number;
  lookupAggregates: { [lookupCount: number]: number };
  characterStats: {
    logFullPath: string[];
    googleFilenames: string[];
    onlyInGoogleFileNames: string[];
  };
  unprocessedLogEntries?: {
    indexes: number[];
    sourceExtensions: { [extension: string]: number };
    destinationExtensions: { [extension: string]: number };
    fullPathChars: { [character: string]: number };
    copyNumbers: { [number: number]: number };
  };
};

const isGaxiosError = (
  error: any,
): error is { errors: { message: string }[] } => {
  return error && typeof error === "object" && error.hasOwnProperty("errors");
};

async function buildDataset(): Promise<DatasetSummary> {
  const authService = new GoogleAuthService();
  const migrationLog = await CSVUtils.readMigrationLog();
  const migrationLogService = new MigrationMapper(migrationLog as any);
  const emails = migrationLogService.emails;

  const summary: DatasetSummary = {
    processedCount: 0,
    csvEntryCount: migrationLogService.csvEntryCount,
    csvCollisionCount: migrationLogService.csvCollisionCount,
    mapCount: migrationLogService.mapCount,
    lookupAggregates: {},
    characterStats: {
      logFullPath: [],
      googleFilenames: [],
      onlyInGoogleFileNames: [],
    },
  };

  /**
   * addMigrationPropertiesToUsersFile
   *
   * This function accepts a users email and the file object from the google API.
   * It will for a matching entry in the migration log, and  if found,
   * add additional properties to the file object.
   */
  function addMigrationPropertiesToUsersFile(
    email: string,
    file: FileResult,
  ): FileResult {
    const migrationEntry = migrationLogService.getEntry(
      email,
      file.googleType,
      file.googlePath,
      file.name,
    );
    if (migrationEntry) {
      file.destinationLocation = migrationEntry.DestinationLocation;
      file.destinationType = migrationEntry.DestinationType;
      file.microsoftPath = migrationEntry.MicrosoftPath;
    }

    return file;
  }

  /**
   * getMigratedFilesByEmail
   *
   * Firstly get all files for a Google email
   * Then, loop over these files and populate the data with:
   * - destinationLocation
   * - destinationType
   * - microsoftPath
   */

  async function getMigratedFilesByEmail(
    email: string,
    emailIndex: number,
  ): Promise<FileResult[]> {
    const identifier = IS_PROD ? `email index ${emailIndex}` : email;

    const googleParamsHash = createHash("sha256")
      .update(JSON.stringify(listParams))
      .digest("hex");

    /**
     * Checking cache for files
     */
    const cachedUserFiles = await CacheUtils.getFileResultsForUser(
      email,
      identifier,
      googleParamsHash,
    );

    if (cachedUserFiles?.length) {
      console.time(`Processing cached files for ${identifier}`);

      const userFilesWithMigrationProperties = [];

      for (const file of cachedUserFiles) {
        const fileWithMaybeExtraProperties = addMigrationPropertiesToUsersFile(
          email,
          file,
        );
        if (fileWithMaybeExtraProperties.destinationLocation?.length) {
          userFilesWithMigrationProperties.push(fileWithMaybeExtraProperties);
        }
      }

      console.timeEnd(`Processing cached files for ${identifier}`);
      return userFilesWithMigrationProperties;
    }

    /**
     * Fetching files from Google Drive
     */
    console.time(`Fetching files for ${identifier}`);

    try {
      const driveService = new GoogleDriveService(
        authService.getJwtForUser(email),
        identifier,
      );

      const userFiles = await driveService.getDriveFiles();
      console.timeEnd(`Fetching files for ${identifier}`);

      await CacheUtils.cacheFileResultsForUser(
        userFiles,
        email,
        identifier,
        googleParamsHash,
      );

      const userFilesWithMigrationProperties = [];

      for (const file of userFiles) {
        const fileWithMaybeExtraProperties = addMigrationPropertiesToUsersFile(
          email,
          file,
        );
        if (fileWithMaybeExtraProperties.destinationLocation?.length) {
          userFilesWithMigrationProperties.push(fileWithMaybeExtraProperties);
        }
      }

      return userFilesWithMigrationProperties;
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
  }

  await PromisePool.withConcurrency(GOOGLE_API_CONCURRENCY)
    .for(emails)
    .process(async (email: string, index: number) => {
      const files = await getMigratedFilesByEmail(email, index);

      CSVUtils.writeOutputCsv(files, { append: true });

      summary.processedCount += files.length;

      return;
    });

  summary.unprocessedLogEntries = migrationLogService.getUnprocessedLogEntries();

  // Lookup aggregates, key is lookup count, and value is number of rows.
  // Zero here, means a row in the migration log was not processed
  summary.lookupAggregates = migrationLogService.getProcessedAggregates();

  summary.characterStats = migrationLogService.getCharacterStats();

  return summary;
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
  const datasetSummary = await buildDataset();

  console.log("Dataset summary", JSON.stringify(datasetSummary));

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

  // If we are re-running the build on a completed dataset,
  // the, don't run the main function again.
  if(MIGRATION_LOG_INPUT_CSV.startsWith("completed/")) {
    return;
  }

  // If we've made it here, we have successfully run, start polling again for updates.
  main();

  return;
}

// Server
const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

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
