import type { FinalTrack, TrackType } from "./types";
import { exec } from "node:child_process";

import * as path from "path";
import * as fs from "fs/promises";
import { log } from "../transport/log";
import { updateStatus } from "../transport/status";
import { randomBytes } from "node:crypto";

const tmpDir = `${path.resolve(import.meta.dir, "..", "..", "tmp")}`;
const binDir = path.resolve(import.meta.dir, "..", "..", "bin");
const packagerPath = path.resolve(binDir, "packager");

export const generateManifest = async (tracks: FinalTrack[]) => {
  const keyId = randomBytes(16).toString("hex");
  const keyValue = randomBytes(16).toString("hex");

  const {
    manifestDirectory,
    videosDirectory,
    audiosDirectory,
    subtitlesDirectory,
  } = await getDirectories();

  const manifestPath = path.resolve(manifestDirectory, "manifest.mpd");

  const fragTracks = tracks
    .map((track) => {
      if (track.originalTrack.type === "VIDEO") {
        const manifestOutput = path.resolve(videosDirectory, track.key);

        return { ...track, manifestOutput };
      } else if (track.originalTrack.type === "AUDIO") {
        const manifestOutput = path.resolve(audiosDirectory, track.key);

        return { ...track, manifestOutput };
      } else if (track.originalTrack.type === "SUBTITLE") {
        const manifestOutput = path.resolve(subtitlesDirectory, track.key);

        return { ...track, manifestOutput };
      }

      return null;
    })
    .filter((track) => !!track);

  const manifestCommand = `${packagerPath} ${fragTracks
    .map(
      (track) =>
        `in=${track.path},stream=${getPackagerStreamType(
          track.originalTrack.type
        )},output=${track.manifestOutput}${getPackagerStreamLanguage(
          track.originalTrack.language
        )},drm_label=test`
    )
    .join(
      " "
    )} --clear_lead 0 --keys=label=test:key_id=${keyId}:key=${keyValue} --enable_raw_key_encryption --mpd_output ${manifestPath}`;

  await log({
    content: "Generating manifest...",
    group: "GENERATING_MANIFEST",
  });

  await updateStatus("GENERATING_MANIFEST");

  await new Promise((resolve, reject) => {
    exec(
      manifestCommand,
      { cwd: import.meta.dir },
      async (err, stdout, stderr) => {
        if (err || stderr) {
          console.log(err, stdout, stderr);
        }

        if (err) {
          await log({
            content: "Error while trying to generate manifest",
            group: "GENERATING_MANIFEST",
          });

          return reject(err);
        }

        await log({
          content: "Manifest generated successfully",
          group: "GENERATING_MANIFEST",
        });

        resolve(stdout);
      }
    );
  });

  return { manifestDirectory: manifestDirectory, keyId, keyValue };
};

const getPackagerStreamLanguage = (language: string | null) => {
  return language ? `,lang=${language}` : "";
};

const getPackagerStreamType = (type: TrackType) => {
  if (type === "VIDEO") return "video";
  if (type === "AUDIO") return "audio";
  if (type === "SUBTITLE") return "text";
};

const getDirectories = async () => {
  const manifestDirectory = path.resolve(tmpDir, "manifest");
  const videosDirectory = path.resolve(tmpDir, "manifest", "videos");
  const audiosDirectory = path.resolve(tmpDir, "manifest", "audios");
  const subtitlesDirectory = path.resolve(tmpDir, "manifest", "subtitles");

  if (!(await fs.exists(manifestDirectory))) {
    await fs.mkdir(manifestDirectory);
  }
  if (!(await fs.exists(videosDirectory))) {
    await fs.mkdir(videosDirectory);
  }
  if (!(await fs.exists(audiosDirectory))) {
    await fs.mkdir(audiosDirectory);
  }
  if (!(await fs.exists(subtitlesDirectory))) {
    await fs.mkdir(subtitlesDirectory);
  }

  return {
    manifestDirectory,
    videosDirectory,
    audiosDirectory,
    subtitlesDirectory,
  };
};
