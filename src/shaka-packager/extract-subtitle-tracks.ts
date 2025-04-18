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

export const extractSubtitleTracks = async (
  videoFilePath: string,
  tracks: Track[]
): Promise<FinalTrack[]> => {
  if (
    !tracks.filter(
      (track) => track.type === "SUBTITLE" && track.codec === "subrip"
    ).length
  )
    return [];

  const ffmpeg = FFmpeg();

  const { subtitlesDirectory } = await getDirectories();

  ffmpeg.setFfmpegPath(path.resolve(binDir, "ffmpeg"));

  ffmpeg.addInput(videoFilePath);
  ffmpeg.addOptions("-threads", "16");

  const singleTracks = tracks
    .map((track) => {
      if (track.type === "SUBTITLE") {
        if (track.codec !== "subrip") return null;

        const id = randomUUID();

        const language = track.language;

        const outputKey = language ? `${id}_${language}.ttml` : `${id}.ttml`;
        const outputPath = path.resolve(subtitlesDirectory, outputKey);

        const ffmpegOutput = ffmpeg.addOutput(outputPath);

        ffmpegOutput
          .addOptions("-map", `0:${track.index}`)
          .addOutputOptions(`-metadata:s:s:0`, `language=${language}`);

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
        (track) => track.type === "SUBTITLE" && track.duration > 0
      )?.[0]?.duration;

      const percent = getPercentage(data, duration);

      if (percent === lastPercent) return;
      lastPercent = percent;

      log({
        content: percent
          ? `Extracting subtitle tracks... (${percent}% completed)`
          : "Extracting subtitle tracks...",
        group: "EXTRACTING_SUBTITLE_TRACKS",
      });
    }, 1000)
  );

  ffmpeg.once("start", () => {
    log({
      content: "Initializing subtitle tracks extraction...",
      group: "EXTRACTING_SUBTITLE_TRACKS",
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
  const subtitlesDirectory = path.resolve(tmpDir, "subtitles");

  if (!(await fs.exists(subtitlesDirectory))) {
    await fs.mkdir(subtitlesDirectory);
  }

  return { subtitlesDirectory };
};
