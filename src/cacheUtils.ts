import { FileResult } from "./types/FileResult";
import { S3Utils } from "./s3Utils";

export class CacheUtils {
  public static async cacheFileResultsForUser(
    fileResults: FileResult[],
    email: string,
    identifier?: string,
  ): Promise<void> {
    console.time(`Caching files for ${identifier}`);

    const jsonl = fileResults.map((fileResult) => {
      return JSON.stringify(fileResult);
    });

    // Upload the file to S3.
    await S3Utils.uploadContentToS3(
      `resources/cache/${email}.jsonl`,
      jsonl.join("\n"),
      "application/jsonl",
    );

    console.timeEnd(`Caching files for ${identifier}`);
  }

  public static async getFileResultsForUser(
    email: string,
    identifier?: string,
  ): Promise<FileResult[] | null> {
    console.time(`Getting cached files for ${identifier}`);

    const key = `resources/cache/${email}.jsonl`;

    // Check if the file exists in S3
    const exists = await S3Utils.s3FileExists(key);

    if (!exists) {
      console.log(`File not found in S3: ${identifier}`);
      return null;
    }

    // Download the file from S3
    const jsonlString = await S3Utils.getContentFromS3(key);
    if (!jsonlString) {
      console.log(`No content found in S3 for ${key}`);
      return null;
    }
    const fileResults: FileResult[] = jsonlString
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.error(`Error parsing line: ${line}`, error);
          return null;
        }
      })
      .filter((fileResult) => fileResult !== null) as FileResult[];

    console.timeEnd(`Getting cached files for ${identifier}`);

    return fileResults;
  }
}
