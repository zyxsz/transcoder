import type { FinalTrack, Track } from "./types";
import FFmpeg, { type FfprobeData, type FfprobeStream } from "fluent-ffmpeg";

import * as path from "path";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { getPercentage } from "../utils/get-percentage";
import { throttle } from "lodash";
import { log } from "../transport/log";

const tmpDir = `${path.resolve(import.meta.dir, "..", "..", "tmp")}`;
const binDir = path.resolve(import.meta.dir, "..", "..", "bin");

export const generateVideoThumbnail = async (videoFilePath: string) => {
  const ffmpeg = FFmpeg();

  const { thumbnailsDirectory } = await getDirectories();

  ffmpeg.setFfmpegPath(path.resolve(binDir, "ffmpeg"));

  ffmpeg.addInput(videoFilePath);
  ffmpeg.addOptions("-threads", "16");

  const thumbnailKey = `${randomUUID()}.jpg`;
  const thumbnailPath = path.resolve(thumbnailsDirectory, thumbnailKey);

  ffmpeg.addOutput(thumbnailPath).addOptions("-ss", "99", "-vframes", "1");

  ffmpeg.once("start", () => {
    log({
      content: "Initializing thumbnails generation...",
      group: "GENERATING_THUMBNAILS",
    });
  });

  ffmpeg.run();

  await new Promise((resolve, reject) => {
    ffmpeg.once("end", async () => {
      await log({
        content: "Thumbnails generated successfully",
        group: "GENERATING_THUMBNAILS",
      });

      resolve(true);
    });
  });

  return { thumbnailPath, thumbnailKey };
};

const getDirectories = async () => {
  const thumbnailsDirectory = path.resolve(tmpDir, "thumbnails");

  if (!(await fs.exists(thumbnailsDirectory))) {
    await fs.mkdir(thumbnailsDirectory);
  }

  return { thumbnailsDirectory };
};
