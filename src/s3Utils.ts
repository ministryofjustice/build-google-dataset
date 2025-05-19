import * as fs from "node:fs";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { MIGRATION_LOG_INPUT_CSV, OUTPUT_CSV } from "./config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export class S3Utils {
  // Define the S3 client parameters
  public static getS3ClientParams(): S3ClientConfig {
    const s3ClientParams: S3ClientConfig = { region: process.env.AWS_REGION };

    if (process.env.MINIO_USER && process.env.MINIO_PASSWORD) {
      s3ClientParams.credentials = {
        accessKeyId: process.env.MINIO_USER,
        secretAccessKey: process.env.MINIO_PASSWORD,
      };
      s3ClientParams.endpoint = process.env.MINIO_ENDPOINT;
      s3ClientParams.forcePathStyle = true;
    }
    return s3ClientParams;
  }

  /**
   * Checks if the S3 bucket is accessible and writable.
   * This function will attempt to write a test file to the S3 bucket.
   * If it fails, it will log an error message.
   */
  public static checkWriteAccess(): void {
    const s3Client = new S3Client(this.getS3ClientParams());
    const testFileName = "write-test.txt";
    const testFileContent = "Test access to S3 bucket";
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: `build-output/${testFileName}`,
      Body: testFileContent,
      ContentType: "text/plain",
    };
    s3Client
      .send(new PutObjectCommand(uploadParams))
      .then(() => {
        console.log(`Successfully uploaded ${testFileName} to S3 bucket.`);
      })
      .catch((err) => {
        console.error(`Error uploading to S3: ${err}`);
      });
  }

  /**
   * Uploads the output CSV file to S3.
   * The file is uploaded to the specified bucket and key.
   * If the upload is successful, a success message is logged.
   * If it fails, an error message is logged.
   */
  public static async uploadToS3(): Promise<void> {
    const s3Client = new S3Client(this.getS3ClientParams());
    const fileStream = fs.createReadStream(`/tmp/${OUTPUT_CSV}`);
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: "build-output/dataset.csv",
      Body: fileStream,
      ContentType: "text/csv",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    console.log(`Successfully uploaded /tmp/${OUTPUT_CSV} to S3 bucket.`);
  }

  /**
   * Upload content to S3
   */
  public static async uploadContentToS3(key: string, content: string, contentType: string): Promise<void> {
    const s3Client = new S3Client(this.getS3ClientParams());
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: content,
      ContentType: contentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
  }

  /**
   * Checks if a file exists in the S3 bucket.
   * @param key The key of the file to check in the S3 bucket.
   * @returns A promise that resolves to true if the file exists, or false if it does not.
   */
  public static async s3FileExists(key: string): Promise<boolean> {
    const s3Client = new S3Client(this.getS3ClientParams());
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
    };

    try {
      await s3Client.send(new HeadObjectCommand(params));
      return true;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        err.name === "NotFound"
      ) {
        return false;
      } else {
        throw err;
      }
    }
  }

  /**
   * @description Polls the S3 bucket for a file with the specified key.
   * It checks every 6 minutes.
   * If the file is found, it resolves the promise with true.
   * If the file is not found after 24 hours, it logs output and resets before trying again.
   *
   * Good to know...
   * - A request to the S3 bucket is made every 6 minutes.
   * - The cost of 1000 requests is $0.0004.
   * - The representative cost over 30 days is $0.00288.
   *
   * @param key The key of the file to check in the S3 bucket.
   * @returns A promise that resolves to true if the file is found, or rejects with an error if an error occurs.
   */
  public static pollS3File(key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let timeoutId: string | number | NodeJS.Timeout | null | undefined = null;
      let attempts = 0;
      let maxAttempts = 120; // 1 hour (adjust to 24 hours once working on dev)
      const interval = 30000; // 30seconds

      const checkFile = async () => {
        try {
          const exists = await this.s3FileExists(key);

          if (exists) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            console.log(`File ${key} was found!.`);
            resolve(true);
          } else if (attempts < maxAttempts) {
            attempts++;
            timeoutId = setTimeout(checkFile, interval);
          } else if (attempts === maxAttempts) {
            console.log(`File ${key} not found after ${maxAttempts} attempts.`);
            // resetting attempts to 0 before running the next check
            attempts = 0;
            timeoutId = setTimeout(checkFile, interval);
          }
        } catch (err) {
          console.error(`Error checking file ${key}:`, err);
          resolve(false);
        }
      };

      return checkFile();
    });
  }

  /**
   * Downloads files from S3 and saves them to the local /tmp/resources directory.
   * The files are downloaded using the S3 client and saved with the same name as in S3.
   */
  public static async pullResourcesFromS3(): Promise<void> {
    const key = MIGRATION_LOG_INPUT_CSV;

    const s3Client = new S3Client(this.getS3ClientParams());

    // Delete the local /tmp/resources folder.
    await fsPromises.rm("/tmp/resources", { recursive: true, force: true });

    // Create the directory.
    await fsPromises.mkdir("/tmp/resources", { recursive: true });

    const downloadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
    };

    // Ensure the directory exists
    const localFile = `/tmp/${key}`;
    const localPath = path.dirname(localFile);
    await fsPromises.mkdir(localPath, { recursive: true });

    const command = new GetObjectCommand(downloadParams);

    const res = await s3Client.send(command);

    if (!res.Body) {
      throw new Error(`No body in response for ${key}`);
    }

    const bodyString = await res.Body.transformToString();

    // Us async fs to write file
    await fsPromises.writeFile(localFile, bodyString);

    console.log(`Downloaded ${key} to ${localFile}`);
  }

  /**
   * Downloads a file from S3 and returns its content as a string.
   */
  public static async getContentFromS3(key: string): Promise<string> {
    const s3Client = new S3Client(this.getS3ClientParams());
    const downloadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
    };

    const command = new GetObjectCommand(downloadParams);

    const res = await s3Client.send(command);

    if (!res.Body) {
      throw new Error(`No body in response for ${key}`);
    }

    return res.Body.transformToString();
  }

  /**
   * Performed once the dataset is built.
   * Moves S3 resource files to a completed directory with a timestamp.
   * The original files are deleted after copying.
   */
  public static async moveS3ResourceFilesToCompleted(): Promise<void> {
    const s3Client = new S3Client(this.getS3ClientParams());
    const key = MIGRATION_LOG_INPUT_CSV;

    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const completedDir = `completed/${timestamp}/`;

    let destination = key.replace(/resources\//, completedDir);

    if (key.startsWith("completed")) {
      destination = key.replace(/completed\//, completedDir);
    }

    const copyParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      CopySource: `${process.env.AWS_S3_BUCKET}/${key}`,
      Key: destination,
    };

    await s3Client.send(new CopyObjectCommand(copyParams));

    console.log(`Copied ${key} to ${destination}`);

    if (key.startsWith("completed")) {
      return;
    }

    // Delete the original file
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
    };

    await s3Client.send(new DeleteObjectCommand(deleteParams));

    console.log(`Deleted original file ${key}`);
  }
}
