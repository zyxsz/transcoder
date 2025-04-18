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

export const generateVideoPreviews = async (
  videoFilePath: string,
  tracks: Track[]
) => {
  const ffmpeg = FFmpeg();

  const { previewsDirectory } = await getDirectories();

  ffmpeg.setFfmpegPath(path.resolve(binDir, "ffmpeg"));

  ffmpeg.addInput(videoFilePath);
  ffmpeg.addOptions("-threads", "16");

  const previewsKey = "%03d.jpg";
  const previewsPath = path.resolve(previewsDirectory, previewsKey);

  ffmpeg
    .addOutput(previewsPath)
    .addOptions("-vf", "fps=1/10,scale=432:243", "-q:v", "10");

  ffmpeg.once("start", () => {
    log({
      content: "Initializing previews generation...",
      group: "GENERATING_PREVIEWS",
    });
  });

  let lastPercent = -1;
  let processEnded = false;

  ffmpeg.on(
    "progress",
    throttle((data) => {
      if (processEnded) return;

      const duration = tracks.filter(
        (track) => track.type === "AUDIO" && track.duration > 0
      )?.[0]?.duration;

      const percent = getPercentage(data, duration);

      if (percent === lastPercent) return;
      lastPercent = percent;

      log({
        content: percent
          ? `Generating video previews... (${percent}% completed)`
          : "Generating video previews...",
        group: "GENERATING_PREVIEWS",
      });
    }, 1000)
  );

  ffmpeg.run();

  await new Promise((resolve, reject) => {
    ffmpeg.once("end", async () => {
      await log({
        content: "Previews generated successfully",
        group: "GENERATING_PREVIEWS",
      });

      resolve(true);
    });
  });

  return { previewsDirectory };
};

const getDirectories = async () => {
  const previewsDirectory = path.resolve(tmpDir, "previews");

  if (!(await fs.exists(previewsDirectory))) {
    await fs.mkdir(previewsDirectory);
  }

  return { previewsDirectory };
};
