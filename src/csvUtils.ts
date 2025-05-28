import * as fs from "fs";
import { parseFile } from "@fast-csv/parse";
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

  /**
   * Writes a list of FileResults to the output CSV.
   * By default, it overwrites OUTPUT_CSV.
   * If `options.append` is true, it will append without writing the header if the file already exists.
   */
  public static writeOutputCsv(
    fileResults: FileResult[],
    options?: { append?: boolean },
  ): void {
    const TMP_OUTPUT_CSV = `/tmp/${OUTPUT_CSV}`;

    const shouldAppend = options?.append === true;
    const fileExists = fs.existsSync(TMP_OUTPUT_CSV);

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

    // Convert fileResults to CSV lines (excluding header).
    const dataRows = fileResults.map((file) =>
      [
        file.id || "",
        file.name || "",
        file.googlePath || "",
        file.url || "",
        file.ownerEmail || "",
        file.viewedByMeTime || "",
        file.lastModifyingUser || "",
        file.destinationLocation || "",
        file.microsoftPath || "",
        file.destinationType || "",
      ]
        .map((value) => `"${value.replace(/"/g, '""')}"`)
        .join(","),
    );

    // If we're appending but the file doesn't exist, we should include a header:
    const needsHeader = !fileExists || !shouldAppend;

    // Build the final CSV content to write
    // (header only if a new file or not appending)
    const rowsToWrite = needsHeader
      ? [headerRow.join(","), ...dataRows]
      : dataRows;

    // Always add a trailing newline between writes
    const csvContent = rowsToWrite.join("\n") + "\n";

    if (shouldAppend) {
      fs.appendFileSync(TMP_OUTPUT_CSV, csvContent, { encoding: "utf8" });
      console.log(`Appended ${fileResults.length} items to ${TMP_OUTPUT_CSV}`);
    } else {
      fs.writeFileSync(TMP_OUTPUT_CSV, csvContent, { encoding: "utf8" });
      console.log(`Wrote ${fileResults.length} items to ${TMP_OUTPUT_CSV}`);
    }
  }
}
