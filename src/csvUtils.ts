import * as fs from "fs";
import { parseFile } from "@fast-csv/parse";
import { writeToString } from "@fast-csv/format";
import { MIGRATION_LOG_INPUT_CSV, OUTPUT_CSV } from "./config";
import { FileResult } from "./types/FileResult";

export class CSVUtils {
  public static async readMigrationLog(
    selectedFields = [
      "SourcePath",
      "FullPath",
      "DestinationLocation",
      "DestinationType",
      "DestinationExtension",
      "SourceExtension",
    ],
  ): Promise<Record<string, string>[]> {
    return new Promise<Record<string, string>[]>((resolve) => {
      const results: Record<string, string>[] = [];
      let invalidRows = 0;
      parseFile(`/tmp/${MIGRATION_LOG_INPUT_CSV}`, {
        headers: true,
        ignoreEmpty: true,
        trim: true,
        strictColumnHandling: true,
        // encoding: "utf8", // Default - may need to be updated.
      })
        .on("error", (error: any) =>
          console.log("Error in readMigrationLog", error),
        )
        .on("data-invalid", (row: any) => {
          console.log("Invalid row in readMigrationLog");
          invalidRows++;
        })
        .on("data", (row: Record<string, string>) => {
          const filteredRow: Record<string, string> = {};
          selectedFields.forEach((field) => {
            if (row[field] !== undefined) {
              filteredRow[field] = row[field];
            }
          });
          results.push(filteredRow);
        })
        .on("end", () => {
          resolve(results);
          console.log(
            `readMigrationLog: ${invalidRows} invalid rows were skipped.`,
          );
        });
    });
  }

  public static initCSVOutputFile(): void {
    const TMP_OUTPUT_CSV = `/tmp/${OUTPUT_CSV}`;

    // The header row for a fresh CSV
    const headerRow = [
      "googleFileId",
      "googleFileName",
      "googlePath",
      "googleUrl",
      "googleOwnerEmail",
      "googleLastAccessedTime",
      "googleLastModifyingUser",
      "microsoftUrl",
      "microsoftPath",
      "microsoftFileType",
    ];

    // Write the header row to the output CSV file.
    fs.writeFileSync(TMP_OUTPUT_CSV, headerRow.join(",") + "\n", {
      encoding: "utf8",
    });
    console.log(`Initialized output CSV at ${TMP_OUTPUT_CSV}`);
  }

  /**
   * Writes a list of FileResults to the output CSV.
   * By default, it overwrites OUTPUT_CSV.
   * If `options.append` is true, it will append without writing the header if the file already exists.
   */
  public static async writeOutputCsv(fileResults: FileResult[]): Promise<void> {
    const TMP_OUTPUT_CSV = `/tmp/${OUTPUT_CSV}`;

    // Convert fileResults to CSV lines (excluding header).
    const dataRows = fileResults
      .filter((file) => file.id?.length)
      .map((file) => [
        file.id,
        file.name || "",
        file.googlePath || "",
        file.url || "",
        file.ownerEmail || "",
        file.viewedByMeTime || "",
        file.lastModifyingUser || "",
        file.destinationLocation || "",
        file.microsoftPath || "",
        file.destinationType || "",
      ]);

    if (!dataRows.length) {
      console.log("No valid file results to write to CSV.");
      return;
    }

    const csvContent = await writeToString(dataRows, {
      quote: true,
      quoteColumns: true,
      includeEndRowDelimiter: true,
    });

    fs.appendFileSync(TMP_OUTPUT_CSV, csvContent, { encoding: "utf8" });
  }

  public static async validateOutputCsv(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let invalidRows = 0;

      // Ensure file exists before appending.
      // if (!fs.existsSync("/tmp/invalid_rows.csv")) {
      //   fs.writeFileSync("/tmp/invalid_rows.csv", ""); // Create file if it doesn't exist.
      // }

      // Delete contents of invalid_rows.csv before validation.
      // fs.writeFileSync("/tmp/invalid_rows.csv", "", { encoding: "utf8" });

      parseFile(`/tmp/${OUTPUT_CSV}`, {
        headers: true,
        strictColumnHandling: true,
      })
        .on("error", (error: any) =>
          console.log("Error in validateOutputCsv", error),
        )
        .on("data", () => {})
        .on("data-invalid", (row: any) => {
          console.log("Invalid row in validateOutputCsv");
          // Append row to /tmp/invalid_rows.csv for debugging.
          // fs.appendFileSync(
          //   "/tmp/invalid_rows.csv",
          //   JSON.stringify(row) + "\n",
          //   { encoding: "utf8" },
          // );
          invalidRows++;
        })
        .on("end", () => {
          console.log(`validateOutputCsv: ${invalidRows} invalid rows.`);
          resolve(invalidRows === 0);
        });
    });
  }
}
