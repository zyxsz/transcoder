import type { FinalTrack, Track } from "./types";
import FFmpeg, { type FfprobeData, type FfprobeStream } from "fluent-ffmpeg";

import * as path from "path";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { throttle } from "lodash";
import { getPercentage } from "../utils/get-percentage";
import { log } from "../transport/log";

const tmpDir = `${path.resolve(import.meta.dir, "..", "..", "tmp")}`;
const binDir = path.resolve(import.meta.dir, "..", "..", "bin");

export const extractAudioTracks = async (
  videoFilePath: string,
  tracks: Track[]
): Promise<FinalTrack[]> => {
  const ffmpeg = FFmpeg();

  const { audiosDirectory } = await getDirectories();

  ffmpeg.setFfmpegPath(path.resolve(binDir, "ffmpeg"));

  ffmpeg.addInput(videoFilePath);
  ffmpeg.addOptions("-threads", "16");

  const singleTracks = tracks
    .map((track) => {
      if (track.type === "AUDIO") {
        const id = randomUUID();

        const language = track.language;
        const formattedBitRate = formatBytes(track.bitRate);

        const outputKey = language
          ? `${id}_${language}_${formattedBitRate}.mp4`
          : `${id}_${formattedBitRate}.mp4`;
        const outputPath = path.resolve(audiosDirectory, outputKey);

        const ffmpegOutput = ffmpeg.addOutput(outputPath);

        ffmpegOutput.addOptions(
          "-map",
          `0:${track.index}`,
          "-vn",
          "-acodec",
          "aac",
          "-b:a",
          track.bitRate?.toString() || "128K"
        );

        if (track.channels > 2) {
          ffmpegOutput.addOptions("-ac", "2");
        }

        return {
          key: outputKey,
          path: outputPath,
          originalTrack: track,
          stream: {
            originalId: track.index,
            codec: "aac",
            duration: track.duration,
            bitRate: track.bitRate || 128000,
            bufSize: track.bufSize,
            channels: track.channels,
            language: track.language,
          },
        } satisfies FinalTrack;
      }

      return null;
    })
    .filter((track) => !!track);

  ffmpeg.run();

  let lastPercent = -1;
  let processEnded = false;

  ffmpeg.on(
    "progress",
    throttle((data) => {
      if (processEnded) return;

      const duration = tracks.filter(
        (track) => track.type === "VIDEO" && track.duration > 0
      )?.[0]?.duration;

      const percent = getPercentage(data, duration);

      if (percent === lastPercent) return;
      lastPercent = percent;

      log({
        content: percent
          ? `Extracting and transcoding audio tracks... (${percent}% completed)`
          : "Extracting and transcoding audio tracks...",
        group: "EXTRACTING_AUDIO_TRACKS",
      });
    }, 1000)
  );

  ffmpeg.run();

  ffmpeg.once("start", () => {
    log({
      content: "Initializing audio tracks extraction and transcode...",
      group: "EXTRACTING_AUDIO_TRACKS",
    });
  });

  await new Promise((resolve, reject) => {
    ffmpeg.once("end", () => {
      processEnded = true;
      resolve(true);
    });
  });

  return singleTracks;
};

const getDirectories = async () => {
  const audiosDirectory = path.resolve(tmpDir, "audios");

  if (!(await fs.exists(audiosDirectory))) {
    await fs.mkdir(audiosDirectory);
  }

  return { audiosDirectory };
};

const formatBytes = (bytes: number) => {
  if (!+bytes) return "0";

  return Math.round(bytes / 1000);
};
