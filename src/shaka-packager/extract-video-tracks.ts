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

export const extractVideoTracks = async (
  videoFilePath: string,
  tracks: Track[]
): Promise<FinalTrack[]> => {
  const ffmpeg = FFmpeg();

  const { videosDirectory } = await getDirectories();

  ffmpeg.setFfmpegPath(path.resolve(binDir, "ffmpeg"));

  ffmpeg.addInput(videoFilePath);
  ffmpeg.addOptions("-threads", "16");

  const singleTracks = tracks
    .map((track) => {
      if (track.type === "VIDEO") {
        const id = randomUUID();

        const formattedBitRate = formatBytes(track.bitRate);

        const outputKey = `${id}_${formattedBitRate}.mp4`;
        const outputPath = path.resolve(videosDirectory, outputKey);

        const ffmpegOutput = ffmpeg.addOutput(outputPath);

        const copyCodec = isCopyCodec(track.codec);

        ffmpegOutput.addOptions("-an", "-map", `0:${track.index}`);

        if (copyCodec) {
          ffmpegOutput.addOptions("-vcodec", "copy");
        }

        return {
          key: outputKey,
          path: outputPath,
          originalTrack: track,
          stream: {
            originalId: track.index,
            codec: track.codec,
            duration: track.duration,
            bitRate: track.bitRate,
            bufSize: track.bufSize,
            channels: track.channels,
            language: track.language,
          },
        } satisfies FinalTrack;
      }

      return null;
    })
    .filter((track) => !!track);

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
          ? `Extracting video tracks... (${percent}% completed)`
          : "Extracting video tracks...",
        group: "EXTRACTING_VIDEO_TRACKS",
      });
    }, 1000)
  );

  ffmpeg.once("start", () => {
    log({
      content: "Initializing video tracks extraction...",
      group: "EXTRACTING_VIDEO_TRACKS",
    });
  });

  ffmpeg.run();

  await new Promise((resolve, reject) => {
    ffmpeg.once("end", () => {
      processEnded = true;
      resolve(true);
    });
  });

  return singleTracks;
};

const getDirectories = async () => {
  const videosDirectory = path.resolve(tmpDir, "videos");

  if (!(await fs.exists(videosDirectory))) {
    await fs.mkdir(videosDirectory);
  }

  return { videosDirectory };
};

const isCopyCodec = (codec: string) => codec === "h264" || codec === "hevc";

const formatBytes = (bytes: number) => {
  if (!+bytes) return "0";

  return Math.round(bytes / 1000);
};
