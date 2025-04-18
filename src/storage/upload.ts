import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { promises as fsPromises } from "fs";
import { mapLimit } from "async";
import * as path from "path";
import * as fs from "fs";
import * as fsPromise from "fs/promises";
import { Upload } from "@aws-sdk/lib-storage";
import { log } from "../transport/log";
import { uploadMultiPartObject } from "./upload-multipart";
import { updateStatus } from "../transport/status";

const maxSizeToMultipart = 1024 * 1024 * 5 * 10;

export async function uploadDir({
  s3Path,
  playlistName,
  bucketName,
  s3Client,
}: {
  playlistName: string;
  s3Path: string;
  bucketName: string;
  s3Client: S3Client;
}) {
  async function getFiles(dir: string): Promise<string | string[]> {
    const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
      })
    );
    return Array.prototype.concat(...files);
  }

  const files = (await getFiles(s3Path)) as string[];

  await updateStatus("UPLOADING");

  const uploads = await mapLimit(files, 10, async (filePath: any) => {
    console.log("Uploading file:", path.relative(s3Path, filePath));

    if ((await fsPromise.stat(filePath)).size > maxSizeToMultipart) {
      await log({
        content: `Uploading file <strong>${path.relative(
          s3Path,
          filePath
        )}</strong> with multipart...`,
        group: "UPLOAD",
      });

      await uploadMultiPartObject(
        s3Client,
        await fsPromise.readFile(filePath),
        {
          Bucket: bucketName,
          ACL: "public-read",
          Key: `${playlistName}/${path.relative(s3Path, filePath)}`,
        },
        path.relative(s3Path, filePath)
      );

      return true;
    }

    await log({
      content: `Uploading file <strong>${path.relative(
        s3Path,
        filePath
      )}</strong>...`,
      group: "UPLOAD",
    });

    const putCommand = new PutObjectCommand({
      Key: `${playlistName}/${path.relative(s3Path, filePath)}`,
      Bucket: bucketName,
      Body: await fsPromise.readFile(filePath),
      ACL: "public-read",
    });

    await s3Client.send(putCommand);

    return true;
  });

  return uploads;
}

export const uploadFile = async ({
  s3Client,
  filePath,
  key,
  bucketName,
}: {
  s3Client: S3Client;
  key: string;
  filePath: string;
  bucketName: string;
}) => {
  const putCommand = new PutObjectCommand({
    Key: key,
    Bucket: bucketName,
    Body: await fsPromise.readFile(filePath),
    ACL: "private",
  });

  await s3Client.send(putCommand);
};
