import { S3Client } from "@aws-sdk/client-s3";
import { getManifest } from "../transport/get-manifest";

export const getS3Client = async ({
  AWS_REGION,
  AWS_ENDPOINT,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
}: {
  AWS_REGION: string;
  AWS_ENDPOINT: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
}) => {
  const s3 = new S3Client({
    region: AWS_REGION,
    endpoint: AWS_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID as string,
      secretAccessKey: AWS_SECRET_ACCESS_KEY as string,
    },
  });

  return s3;
};
