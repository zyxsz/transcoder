import FFmpeg, { type FfprobeData, type FfprobeStream } from "fluent-ffmpeg";

import * as path from "path";
import type { Track } from "./types";
import { timemarkToSeconds } from "../utils/timemark-to-seconds";
import { updateStatus } from "../transport/status";

const binDir = path.resolve(import.meta.dir, "..", "..", "bin");

export const getVideoTracks = async (
  videoFilePath: string
): Promise<Track[]> => {
  const ffmpeg = FFmpeg();

  ffmpeg.setFfprobePath(path.resolve(binDir, "ffprobe"));

  await updateStatus("FETCHING_METADATA");

  const probeData = await new Promise<FfprobeData>((resolve, reject) =>
    ffmpeg.addInput(videoFilePath).ffprobe((err, data) => {
      if (err) reject(err);

      resolve(data);
    })
  );

  const tracks: Track[] = await Promise.all(
    probeData.streams
      .filter((s) =>
        s.tags?.mimetype ? s.tags?.mimetype !== "image/png" : true
      )
      .map((stream) => {
        let language: string | null =
          stream?.tags?.language || stream?.tags?.lang || null;
        let isForced = null;

        if (language) {
          const languageTitle = stream.tags?.title;
          const languageTitleIsForced = languageTitle?.includes("Forced");

          if (languageTitleIsForced) {
            isForced = true;
          }

          if (languageTitle === "Portuguese (Brazilian)") {
            language = "pt-br";
          } else if (languageTitle === "Portuguese (European)") {
            language = "pt";
          }
        }

        const type =
          (stream.codec_type === "video" && "VIDEO") ||
          (stream.codec_type === "audio" && "AUDIO") ||
          (stream.codec_type === "subtitle" && "SUBTITLE") ||
          null;

        if (type === null) return null;
        if (!stream.codec_name) return null;

        const codec = stream.codec_name;
        const channels = stream.channels || 2;

        const bitRate = getStreamBitRate(stream);
        const bufSize = type === "VIDEO" ? getStreamBufSize(stream) : undefined;
        const duration = getStreamDuration(stream);

        if (language === "und") {
          language = "eng";
        }

        return {
          index: stream.index,
          codec,
          language,
          type,
          bitRate,
          bufSize,
          channels,
          isForced,
          duration,
        } satisfies Track;
      })
      .filter((stream) => !!stream)
  );

  return tracks;
};

const getStreamDuration = (stream: FfprobeStream) => {
  if (!stream.duration || stream.duration === "N/A") {
    const durationTag = stream.tags["DURATION"];

    if (!durationTag) return 0;

    return timemarkToSeconds(durationTag);
  }

  if (!stream.duration) return 0;

  return parseInt(stream.duration);
};

const getStreamBitRate = (stream: FfprobeStream) => {
  const type =
    (stream.codec_type === "video" && "VIDEO") ||
    (stream.codec_type === "audio" && "AUDIO") ||
    (stream.codec_type === "subtitle" && "SUBTITLE");

  return parseInt(
    (type === "AUDIO"
      ? stream.bit_rate && stream.bit_rate !== "N/A"
        ? stream.bit_rate
        : 128000
      : stream?.bit_rate
      ? parseInt(
          stream.bit_rate === "N/A"
            ? stream?.tags?.["BPS"] || 4000000
            : stream.bit_rate
        )
      : 4000000) as string
  );
};

const getStreamBufSize = (stream: FfprobeStream) => {
  return (
    stream?.bit_rate
      ? parseInt(
          stream.bit_rate === "N/A" ? stream.tags["BPS"] : stream.bit_rate
        ) * 2
      : "8M"
  ).toString();
};
