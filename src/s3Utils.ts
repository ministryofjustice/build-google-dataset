import * as fs from 'fs';
import { OUTPUT_CSV } from "./config";
import {
  S3Client,
  PutObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

const s3ClientParams: S3ClientConfig = { region: process.env.AWS_REGION };
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


  public static checkWriteAccess(): void {

    const s3Client = new S3Client(this.getS3ClientParams());

    // Check writing a test file to build-output.
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
}
