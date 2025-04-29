import * as fs from 'fs';
import { OUTPUT_CSV } from "./config";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
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
  public static uploadToS3(): void {
    const s3Client = new S3Client(this.getS3ClientParams());
    const fileStream = fs.createReadStream(OUTPUT_CSV);
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: 'build-output/dataset.csv',
      Body: fileStream,
      ContentType: 'text/csv'
    };

    s3Client.send(new PutObjectCommand(uploadParams))
      .then(() => {
        console.log(`Successfully uploaded ${OUTPUT_CSV} to S3 bucket.`);
      })
      .catch(err => {
        console.error(`Error uploading to S3: ${err}`);
      });
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
      if (err && typeof err === 'object' && 'name' in err && err.name === 'NotFound') {
        return false;
      } else {
        throw err;
      }
    }
  }

  /**
   * @description Polls the S3 bucket for a file with the specified key.
   * It checks every 6 minutes for up to 24 hours.
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
      let maxAttempts = 240; // 24 hours
      const interval = 360000; // 6 minutes

      const checkFile = async () => {
        try {
          const exists = await this.s3FileExists(key);

          if (exists) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
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
          reject(err);
        }
      };

      return checkFile();
    });
  }
}
