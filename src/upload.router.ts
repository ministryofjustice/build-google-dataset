import { S3Client } from "@aws-sdk/client-s3";
import { Upload, Progress } from "@aws-sdk/lib-storage";
import express, { type Request, type Response } from "express";
import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const router = express.Router();

import { S3Utils } from "./s3Utils";

router.get("/", (req: Request, res: Response) => {
  // Basic html form for submitting a file to /uploads
  res.send(`
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">Upload</button>
    </form>
  `);
});

router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).send("No file uploaded.");
      return;
    }

    const s3Client = new S3Client(S3Utils.getS3ClientParams());

    try {
      const parallelUploads3 = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.AWS_S3_BUCKET,
          Key: `resources/${req.file.originalname}`,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        },

        leavePartsOnError: false,
      });

      parallelUploads3.on("httpUploadProgress", (progress: Progress) => {
        console.log(progress);
      });

      await parallelUploads3.done();
    } catch (e) {
      console.log(e);
      res.status(500).send("Error uploading file.");
      return;
    }

    res.status(200).send("File uploaded successfully.");
    return;
  },
);

export { router };
