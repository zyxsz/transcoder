import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  type CompleteMultipartUploadCommandInput,
  type CreateMultipartUploadCommandInput,
  type S3Client,
  type UploadPartCommandInput,
} from "@aws-sdk/client-s3";
import { log } from "../transport/log";
import { humanFileSize } from "../utils/human-file-size";

export const uploadMultiPartObject = async (
  client: S3Client,
  file: Buffer,
  createParams: CreateMultipartUploadCommandInput,
  fileName: string
): Promise<void> => {
  try {
    const createUploadResponse = await client.send(
      new CreateMultipartUploadCommand(createParams)
    );
    const { Bucket, Key } = createParams;
    const { UploadId } = createUploadResponse;

    // 5MB is the minimum part size
    // Last part can be any size (no min.)
    // Single part is treated as last part (no min.)
    const partSize = 1024 * 1024 * 5 * 10; // 5MB
    const fileSize = file.length;
    const numParts = Math.ceil(fileSize / partSize);

    const uploadedParts = [];
    let remainingBytes = fileSize;

    await log({
      content: `Uploading file <strong>${fileName}</strong> in <strong>${numParts}</strong> parts of <strong>${humanFileSize(
        partSize
      )}</strong>...`,
      group: "UPLOAD",
    });

    for (let i = 1; i <= numParts; i++) {
      let startOfPart = fileSize - remainingBytes;
      let endOfPart = Math.min(partSize, startOfPart + remainingBytes);

      if (i > 1) {
        endOfPart = startOfPart + Math.min(partSize, remainingBytes);
        startOfPart += 1;
      }

      const uploadParams: UploadPartCommandInput = {
        // add 1 to endOfPart due to slice end being non-inclusive
        Body: file.subarray(startOfPart, endOfPart + 1),
        Bucket,
        Key,
        UploadId,
        PartNumber: i,
      };
      const uploadPartResponse = await client.send(
        new UploadPartCommand(uploadParams)
      );

      await log({
        content: `Part <strong>#${i}</strong> of file <strong>${fileName}</strong> uploaded successfully`,
        group: "UPLOAD",
      });

      remainingBytes -= Math.min(partSize, remainingBytes);

      // For each part upload, you must record the part number and the ETag value.
      // You must include these values in the subsequent request to complete the multipart upload.
      // https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html
      uploadedParts.push({ PartNumber: i, ETag: uploadPartResponse.ETag });
    }

    const completeParams: CompleteMultipartUploadCommandInput = {
      Bucket,
      Key,
      UploadId,
      MultipartUpload: {
        Parts: uploadedParts,
      },
    };

    await log({
      content: `Completing multipart upload for file <strong>${fileName}</strong>...`,
      group: "UPLOAD",
    });

    const completeData = await client.send(
      new CompleteMultipartUploadCommand(completeParams)
    );

    await log({
      content: `Multipart upload for file <strong>${fileName}</strong> completed successfully`,
      group: "UPLOAD",
    });
  } catch (e) {
    throw e;
  }
};
