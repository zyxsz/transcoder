import * as path from "path";
import * as fs from "fs";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { log } from "../transport/log";
import { throttle } from "lodash";
import { humanFileSize } from "../utils/human-file-size";
import { updateStatus } from "../transport/status";

const oneMB = 1024 * 1024 * 10;

export const getObjectRange = ({
  s3Client,
  bucket,
  key,
  start,
  end,
}: {
  s3Client: S3Client;
  bucket: string;
  key: string;
  start: number;
  end: number;
}) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    Range: `bytes=${start}-${end}`,
  });

  return s3Client.send(command);
};

export const getRangeAndLength = (contentRange: string) => {
  const [range, length] = contentRange.split("/");
  const [start, end] = range.split("-");
  return {
    start: parseInt(start),
    end: parseInt(end),
    length: parseInt(length),
  };
};

export const isComplete = ({ end, length }: { end: number; length: number }) =>
  end === length - 1;

let completed = false;

export const downloadInChunks = async ({
  s3Client,
  bucket,
  key,
  outputPath,
  logging,
}: {
  s3Client: S3Client;
  bucket: string;
  key: string;
  outputPath: string;
  logging?: boolean;
}) => {
  return new Promise(async (resolve, error) => {
    const writeStream = fs
      .createWriteStream(outputPath)
      .on("error", (err: any) => console.error(err));

    let rangeAndLength = { start: -1, end: -1, length: -1 };

    completed = false;

    await updateStatus("DOWNLOADING");

    while (!isComplete(rangeAndLength)) {
      const { end } = rangeAndLength;
      const nextRange = { start: end + 1, end: end + oneMB };

      const { ContentRange, Body } = await getObjectRange({
        s3Client,
        bucket,
        key,
        ...nextRange,
      });

      if (logging) sendLog(nextRange.start, nextRange.end);

      if (!Body || !ContentRange) throw error("Object not found");

      writeStream.write(await Body.transformToByteArray());
      rangeAndLength = getRangeAndLength(ContentRange);

      if (isComplete(rangeAndLength)) {
        completed = true;

        await log({
          content: `Download of the video file completed successfully`,
          group: "DOWNLOADING",
        });

        resolve(true);
      }
    }
  });
};

const sendLog = throttle(
  async (start: number, end: number) => {
    if (completed) return;

    await log({
      content: `Downloading <strong>${humanFileSize(
        start
      )}</strong> to <strong>${humanFileSize(
        end
      )}</strong> of the video file...`,
      group: "DOWNLOADING",
    });
  },
  1000,
  { trailing: true }
);
