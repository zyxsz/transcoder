import * as path from "path";
import { getVideoTracks } from "./get-video-tracks";
import { extractVideoTracks } from "./extract-video-tracks";
import { generateManifest } from "./generate-manifest";
import { getS3Client } from "../storage/s3";
import { getEnv } from "../utils/get-env";
import * as fsPromise from "fs/promises";

import { extractAudioTracks } from "./extract-audio-tracks";
import { extractSubtitleTracks } from "./extract-subtitle-tracks";
import { uploadDir, uploadFile } from "../storage/upload";
import { downloadInChunks } from "../storage/download";
import { updateStatus } from "../transport/status";
import { generateVideoThumbnail } from "./generate-video-thumbnail";
import { sendMessage } from "../transport/message";
import { generateVideoPreviews } from "./generate-video-previews";
import { generatePreviewsFile } from "../utils/generate-previews-file";
import { getManifest } from "../transport/get-manifest";
import { randomUUID } from "crypto";
import { updateTranscode } from "../transport/update";
import { sendMedia } from "../transport/send-media";

const tmpDir = `${path.resolve(import.meta.dir, "..", "..", "tmp")}`;

export const initShaka = async () => {
  await updateTranscode({
    isRunning: true,
    jobStartedAt: new Date().toISOString(),
  });

  if (!(await fsPromise.exists(tmpDir))) {
    await fsPromise.mkdir(tmpDir);
  }

  const {
    FOLDER,
    OBJECT_KEY,

    BUCKET,
    AWS_REGION,
    AWS_ENDPOINT,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
  } = await getManifest();

  const s3Client = await getS3Client({
    AWS_REGION,
    AWS_ENDPOINT,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
  });

  // const videoPath = path.resolve(tmpDir, "video.mkv");
  const videoPath = path.resolve(tmpDir, randomUUID());
  const PLAYLIST_ID = `${FOLDER || "media"}/${randomUUID()}`;

  await downloadInChunks({
    bucket: BUCKET,
    key: OBJECT_KEY,
    s3Client: s3Client,
    outputPath: videoPath,
    logging: true,
  });

  const tracks = await getVideoTracks(videoPath);

  await updateStatus("FRAGMENTING");

  const extractedVideoTracks = await extractVideoTracks(videoPath, tracks);

  const extractedAudioTracks = await extractAudioTracks(videoPath, tracks);

  const extractedSubtitleTracks = await extractSubtitleTracks(
    videoPath,
    tracks
  );

  const { thumbnailPath, thumbnailKey } = await generateVideoThumbnail(
    videoPath
  );

  const { previewsDirectory } = await generateVideoPreviews(videoPath, tracks);
  const previewsPath = path.resolve(previewsDirectory, "previews.json");

  await generatePreviewsFile(previewsDirectory, previewsPath);

  const uploadThumbnailKey = `${PLAYLIST_ID}/thumbnails/${thumbnailKey}`;
  const previewsKey = `${PLAYLIST_ID}/previews.json`;

  await fsPromise.rm(videoPath);

  const extractedTracks = [
    ...extractedVideoTracks,
    ...extractedAudioTracks,
    ...extractedSubtitleTracks,
  ];

  const { manifestDirectory, keyId, keyValue } = await generateManifest(
    extractedTracks
  );

  await uploadFile({
    bucketName: BUCKET,
    key: uploadThumbnailKey,
    filePath: thumbnailPath,
    s3Client,
  });

  await uploadFile({
    bucketName: BUCKET,
    key: previewsKey,
    filePath: previewsPath,
    s3Client,
  });

  await sendMessage("assign-thumbnail", { thumbnailKey: uploadThumbnailKey });

  await uploadDir({
    bucketName: BUCKET,
    s3Path: manifestDirectory,
    playlistName: PLAYLIST_ID,
    s3Client,
  });

  await updateStatus("COMPLETED");

  const mediaObject = {
    key: PLAYLIST_ID,
    manifestKey: `${PLAYLIST_ID}/manifest.mpd`,
    encryption: {
      keyId,
      keyValue,
    },
    origin: "SHAKA-PACKAGER",
    type: "DASH",
    streams: extractedTracks.map((track) => track.stream),
    thumbnailKey,
    previewsKey,
  } as const;

  await updateTranscode({
    isRunning: false,
    jobEndedAt: new Date().toISOString(),
  });

  await sendMedia(mediaObject);

  process.exit(0);
};
