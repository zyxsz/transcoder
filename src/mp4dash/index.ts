import Ffmpeg from "fluent-ffmpeg";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import * as path from "path";
import * as fs from "fs";
import { Readable } from "node:stream";
import { v4 as uuid } from "uuid";
import { exec, spawn } from "node:child_process";
import { probe } from "./probe";
import { uploadDir } from "../storage/upload";
import amqplib from "amqplib";
import { sendMessage } from "./message";
import { downloadInChunks } from "../storage/download";
import { throttle } from "lodash";
import * as fsPromises from "fs/promises";
import { generatePreviewsFile } from "../utils/generate-previews-file";
import { randomUUID } from "node:crypto";

const tmpDir = `${path.resolve(import.meta.dir, "..", "tmp")}`;
const binDir = path.resolve(import.meta.dir, "..", "bin");

const timemarkToSeconds = (timemark: string) => {
  if (typeof timemark === "number") {
    return timemark;
  }

  if (timemark.indexOf(":") === -1 && timemark.indexOf(".") >= 0) {
    return Number(timemark);
  }

  var parts = timemark.split(":");

  // add seconds
  var secs = Number(parts.pop());

  if (parts.length) {
    // add minutes
    secs += Number(parts.pop()) * 60;
  }

  if (parts.length) {
    // add hours
    secs += Number(parts.pop()) * 3600;
  }

  return secs;
};

let processEnded = false;

async function init() {
  // const USE_CUDA = process.env.USE_CUDA === "true" ? true : false;

  const USE_CUDA = false;

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }

  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
    },
  });
  //ffmpeg_cuda
  Ffmpeg.setFfmpegPath(
    path.resolve(binDir, USE_CUDA ? "ffmpeg_with_cuda" : "ffmpeg")
  );
  Ffmpeg.setFfprobePath(path.resolve(binDir, "ffprobe"));

  const TRANSCODE_ID = process.env.TRANSCODE_ID as string;
  const EXTERNAL_ID = process.env.EXTERNAL_ID as string;
  const OBJECT_KEY = process.env.KEY as string;

  const RMQ_URL = process.env.RMQ_URL as string;

  const BUCKET = process.env.AWS_S3_BUCKET as string;
  const PLAYLIST_ID = process.env.PLAYLIST_ID as string;

  const ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID as string;
  const ENCRYPTION_KEY_VALUE = process.env.ENCRYPTION_KEY_VALUE as string;

  if (!OBJECT_KEY) throw new Error("Object key not found");

  const queueConnection = await amqplib.connect(RMQ_URL);
  const queueChannel = await queueConnection.createChannel();

  // const queueChannel = { sendToQueue: () => {} };

  await sendMessage(queueChannel, "transcode-log", {
    type: "LOG",
    content: "Queue connected",
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
    ts: Date.now(),
  });

  const playlistPath = `${path.resolve(tmpDir, "playlist")}`;
  const previewsPath = path.resolve(tmpDir, "previews");

  const thumbnailsPath = path.resolve(playlistPath, "thumbnails");
  const thumbnailPath = path.resolve(thumbnailsPath, `${randomUUID()}.png`);

  if (!fs.existsSync(playlistPath)) {
    fs.mkdirSync(playlistPath);
  }

  if (!fs.existsSync(previewsPath)) {
    fs.mkdirSync(previewsPath);
  }

  if (!fs.existsSync(thumbnailsPath)) {
    fs.mkdirSync(thumbnailsPath);
  }

  const outputDir = path.resolve(tmpDir, "out_" + Date.now());

  const videoPath = path.resolve(tmpDir, "video.mkv");
  // const videoPath = path.resolve(tmpDir, "video.mp4");

  const downloadStartedAt = Date.now();

  await sendMessage(queueChannel, "transcode-log", {
    type: "LOG",
    content: "Downloading video...",
    group: "DOWNLOAD",
    startAt: downloadStartedAt,
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
    ts: Date.now(),
  });

  await sendMessage(queueChannel, "transcode-status", {
    status: "DOWNLOADING",
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
    ts: Date.now(),
  });

  await downloadInChunks({
    bucket: BUCKET as string,
    key: OBJECT_KEY,
    s3Client: s3,
    outputPath: videoPath,
    logging: true,
  });

  await sendMessage(queueChannel, "transcode-log", {
    type: "LOG",
    content: "Video downloaded successfully",
    group: "DOWNLOAD",
    startAt: downloadStartedAt,
    endAt: Date.now(),
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
    ts: Date.now(),
  });

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const probeStartAt = Date.now();

  await sendMessage(queueChannel, "transcode-log", {
    type: "LOG",
    content: "Fetching video metadata...",
    group: "METADATA",
    startAt: probeStartAt,
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
    ts: Date.now(),
  });

  await sendMessage(queueChannel, "transcode-status", {
    status: "FETCHING_METADATA",
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
  });

  const videoProbe = await probe(videoPath);

  await sendMessage(queueChannel, "transcode-log", {
    type: "LOG",
    content: "Fetched video metadata successfully",
    group: "METADATA",
    startAt: probeStartAt,
    endAt: Date.now(),
    transcodeId: TRANSCODE_ID,
    externalId: EXTERNAL_ID,
    ts: Date.now(),
  });

  const ffmpeg = Ffmpeg();

  ffmpeg
    .addInput(videoPath)
    .addInputOptions("-hwaccel", "auto", "-strict", "2");

  const streams = (
    await Promise.all(
      videoProbe.streams
        .filter((s) =>
          s.tags?.mimetype ? s.tags?.mimetype !== "image/png" : true
        )
        .map((stream) => {
          let language = stream?.tags?.language || stream?.tags?.lang || "und";
          const streamId = uuid();

          if (stream.codec_type === "video") {
            const streamOutputPath = path.resolve(
              outputDir,
              language === "und"
                ? `${streamId}.mp4`
                : `${streamId}_${language}.mp4`
            );

            const output = ffmpeg
              .addOutput(streamOutputPath)
              .outputFormat("mp4")
              .addOptions(
                // "-b:v",
                // "14M",
                "-an",
                "-map",
                "0:" + stream.index
              );

            // if (stream.codec_name !== "h264" || stream.pix_fmt !== "yuv420p") {

            const copyCodec =
              stream.codec_name === "h264" || stream.codec_name === "hevc";

            if (!copyCodec) {
              output.addOptions(
                "-vtag",
                "hvc1",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "19",
                "-b:v",
                (stream?.bit_rate
                  ? parseInt(
                      stream.bit_rate === "N/A"
                        ? stream.tags["BPS"]
                        : stream.bit_rate
                    )
                  : "4M"
                ).toString(),
                "-bufsize",
                (stream?.bit_rate
                  ? parseInt(
                      stream.bit_rate === "N/A"
                        ? stream.tags["BPS"]
                        : stream.bit_rate
                    ) * 2
                  : "8M"
                ).toString(),
                // "-profile:v",
                // "high",
                "-bf",
                "3",
                "-b_ref_mode",
                "2",
                "-temporal-aq",
                "1",
                "-rc-lookahead",
                "20",
                "-vsync",
                "0"
              );

              if (USE_CUDA) {
                output.addOptions("-vcodec", "hevc_nvenc");
              } else {
                output.addOptions("-vcodec", "libx265");
              }
            } else {
              output.addOptions("-vcodec", "copy");
            }

            const videoDuration =
              stream?.duration === "N/A"
                ? null
                : parseInt(stream.duration as string);

            const videoDurationTag = stream?.tags?.["DURATION"]
              ? timemarkToSeconds(stream?.tags?.["DURATION"])
              : null;

            const thumbnailPeriod = videoDuration || videoDurationTag || null;

            ffmpeg
              .addOutput(thumbnailPath)
              .addOptions("-ss", "66", "-vframes", "1");

            // ffmpeg
            //   .addOutput(path.resolve(previewsPath, "%03d.jpg"))
            //   .addOptions("-vf", "fps=1/10,scale=432:243");

            //"-q:v", "10"

            return {
              id: streamId,
              type: "VIDEO",
              path: streamOutputPath,
              language,
            };
          } else if (stream.codec_type === "audio") {
            const streamOutputPath = path.resolve(
              outputDir,
              `${streamId}_${language}.mp4`
            );

            const output = ffmpeg
              .addOutput(streamOutputPath)
              .outputFormat("mp4")
              .addOptions(
                "-map",
                "0:" + stream.index,
                "-vn",
                "-acodec",
                "aac",
                "-b:a",
                stream.bit_rate && stream.bit_rate !== "N/A"
                  ? stream.bit_rate
                  : "128k"
              );

            if ((stream.channels || 0) >= 6) {
              output.addOptions("-ac", "2");
            }

            return {
              id: streamId,
              type: "AUDIO",
              path: streamOutputPath,
              index: stream.index,
              codec_name: stream.codec_name,
              language,
            };
          } else if (
            stream.codec_type === "subtitle" &&
            stream.codec_name !== "dvd_subtitle"
          ) {
            console.log(stream);

            const languageTitle = stream.tags?.title;
            // const isForced = languageTitle?.includes("Forced");

            if (languageTitle === "Portuguese (Brazilian)") {
              language = "pt-br";
            } else if (languageTitle === "Portuguese (European)") {
              language = "pt";
            }

            const streamOutputPath = path.resolve(
              outputDir,
              `${streamId}_${language}.srt`
            );

            ffmpeg
              .addOutput(streamOutputPath)
              .outputFormat("srt")
              .addOptions("-map", "0:" + stream.index)
              .addOutputOptions(`-metadata:s:s:0`, `language=${language}`);
            // .addOption();

            return {
              id: streamId,
              type: "SUBTITLE",
              path: streamOutputPath,
              language,
            };
          }
        })
    )
  ).filter((s) => !!s);

  const aditionalStreams: any[] = [];

  const processingVideoStartAt = Date.now();

  streams
    .map((stream) => {
      if (stream?.type === "AUDIO") {
        if (stream?.codec_name === "dts") return stream;

        const streamId = uuid();

        const streamOutputPath = path.resolve(
          outputDir,
          `${streamId}_${stream.language}_raw.mp4`
        );

        ffmpeg
          .addOutput(streamOutputPath)
          .outputFormat("mp4")
          .addOptions(
            "-map",
            "0:" + stream.index,
            "-vn",
            "-acodec",
            "copy"
            // "-b:a",
            // "128k"
          );

        // if ((stream.channels || 0) >= 6) {
        //   output.addOptions("-ac", "1");
        // }

        const newStreams = [
          {
            ...stream,
            id: streamId,
            type: "AUDIO",
            path: streamOutputPath,
            raw: true,
          },
        ];

        aditionalStreams.push(...newStreams);

        return newStreams;
      }

      return stream;
    })
    .filter((aStream) => !!aStream);

  const allStreams = [...streams, ...aditionalStreams];

  ffmpeg.on(
    "progress",
    throttle(function (progress) {
      if (processEnded) return;

      const videoDuration = parseInt(
        videoProbe.streams.filter((s) => s.duration !== "N/A")?.[0]
          ?.duration as string
      );

      const videoDurationTag = videoProbe.streams.filter(
        (s) => s.tags?.["DURATION"]
      )?.[0]?.tags?.DURATION as string | null;

      const duration = videoDuration
        ? videoDuration
        : videoDurationTag
        ? timemarkToSeconds(videoDurationTag)
        : NaN;

      // const duration =
      //   parseInt(
      //     videoProbe.streams.filter((s) => s.duration !== "N/A")?.[0]?.duration ||
      //       "0"
      //   ) || 0;

      // console.log(
      //   timemarkToSeconds(progress.timemark),
      //   duration,
      //   videoProbe.streams.filter((s) => s.codec_type === "video")
      // );

      const percentage =
        duration > 0
          ? (timemarkToSeconds(progress.timemark) / duration) * 100
          : null;

      const finalPercentage = percentage?.toFixed(2);

      if (percentage && percentage > 100) return;

      sendMessage(queueChannel, "transcode-log", {
        type: "LOG",
        content: percentage
          ? `Video processing... ${finalPercentage}% completed`
          : "Video processing...",
        group: "TRANSCODE",
        subGroup: "PROGRESS",
        ts: Date.now(),
        transcodeId: TRANSCODE_ID,
        externalId: EXTERNAL_ID,
      });
    }, 5000)
  );

  ffmpeg.on("error", (err, stdout, stderr) => {
    console.log(err, stdout, stderr);

    sendMessage(queueChannel, "transcode-status", {
      status: "TRANSCODE_ERROR",
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });

    sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Error while processing video",
      group: "ERROR",
      startAt: processingVideoStartAt,
      endAt: Date.now(),
      data: { error: err, stdout: stdout, stderr: stderr },
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });
  });

  ffmpeg.on("end", async (a, b) => {
    processEnded = true;
    console.log("Removing original video file");
    await fsPromises.rm(videoPath);

    console.log("Video file removed");

    // console.log(a, b);

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Video processed successfully",
      group: "TRANSCODE",
      startAt: processingVideoStartAt,
      endAt: Date.now(),
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    const fragmentingStartAt = Date.now();

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Fragmenting tracks...",
      group: "FRAGMENTING",
      startAt: fragmentingStartAt,
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    await sendMessage(queueChannel, "transcode-status", {
      status: "FRAGMENTING",
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });

    const fragStreams = await Promise.all(
      allStreams.map(async (stream) => {
        if (stream?.type === "SUBTITLE")
          return { ...stream, fragmentedPath: null };

        const streamOutputPath = path.resolve(
          tmpDir,
          `${stream?.id}${
            stream?.language && stream.language !== "und"
              ? `_${stream?.language}`
              : ""
          }_fragmented${stream.raw ? "_raw" : ""}.mp4`
        );

        const command = `../bento4/bin/mp4fragment --fragment-duration 4000 ${stream?.path} ${streamOutputPath}`;

        await new Promise((resolve) => {
          exec(
            command,
            { cwd: import.meta.dir },
            async (err, stdout, stderr) => {
              console.log("frag: ", err, stdout, stderr);

              await sendMessage(queueChannel, "transcode-log", {
                type: "RAW_LOG",
                content: "Fragmenting response",
                subGroup: "FRAGMENTING",
                ts: Date.now(),
                data: { error: err, stdout: stdout, stderr: stderr },
                transcodeId: TRANSCODE_ID,
                externalId: EXTERNAL_ID,
              });

              resolve(true);
            }
          );
        });

        return {
          ...stream,
          fragmentedPath: `${streamOutputPath}`,
        };
      })
    );

    await Promise.all(
      allStreams.map(async (stream) => {
        if (stream?.type === "SUBTITLE") return null;

        await fsPromises.rm(stream?.path);
      })
    );

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Tracks fragmented",
      group: "FRAGMENTING",
      startAt: fragmentingStartAt,
      endAt: Date.now(),
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    const manifestStartAt = Date.now();

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Generating manifest...",
      group: "MANIFEST",
      startAt: manifestStartAt,
      endAt: Date.now(),
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    const manifest = `../bento4/bin/mp4dash ${fragStreams
      .map((stream) => {
        if (stream.language && stream.language !== "und") {
          // return `[${stream.type === "SUBTITLE" ? "+format=ttml" : ""}]${
          //   stream.fragmentedPath || stream.path
          // }`;
          return `[${
            stream.type === "SUBTITLE" ? "+format=ttml," : ""
          }+language=${stream.language}]${
            stream.fragmentedPath || stream.path
          }`;
        }

        return stream.fragmentedPath || stream.path;
      })
      .join(
        " "
      )} --language-map=und:eng --mpd-name manifest.mpd -f -o ${playlistPath} --always-output-lang --subtitles --use-segment-timeline ${
      ENCRYPTION_KEY_ID
        ? `--encryption-key ${ENCRYPTION_KEY_ID}:${ENCRYPTION_KEY_VALUE}`
        : ""
    }`;

    // --encryption-key 668b93dd8024fef229d369dd8174253f:222320452d2bca41177714fa991a9e52

    //--no-split   --no-media --use-segment-timeline b

    // await $`${manifest.toString()}`;

    await sendMessage(queueChannel, "transcode-status", {
      status: "GENERATING_MANIFEST",
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });

    const manifestResult = await new Promise((resolve) => {
      exec(manifest, { cwd: import.meta.dir }, (err, stdout, stderr) => {
        sendMessage(queueChannel, "transcode-log", {
          type: "RAW_LOG",
          content: "Manifest response",
          group: "MANIFEST",
          ts: Date.now(),
          data: { error: err, stdout: stdout, stderr: stderr },
          transcodeId: TRANSCODE_ID,
          externalId: EXTERNAL_ID,
        });

        console.log(err, stdout, stderr);

        if (err) return resolve(false);

        return resolve(true);
      });
    });

    if (!manifestResult) return process.exit(1);

    // const previewsOutput = path.resolve(playlistPath, "previews.json");

    // await generatePreviewsFile(previewsPath, previewsOutput);

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Manifest generated",
      group: "MANIFEST",
      startAt: manifestStartAt,
      endAt: Date.now(),
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    await Promise.all(
      fragStreams.map(async (stream) => {
        await fsPromises.rm(stream?.fragmentedPath || stream.path);
      })
    );

    const uploadStartAt = Date.now();

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Uploading...",
      group: "UPLOAD",
      startAt: uploadStartAt,
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    await sendMessage(queueChannel, "transcode-status", {
      status: "UPLOADING",
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });

    await uploadDir({
      s3Client: s3,
      playlistName: PLAYLIST_ID,
      bucketName: BUCKET,
      s3Path: playlistPath,
    });

    await sendMessage(queueChannel, "assign-thumbnail", {
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      thumbnailKey: `${PLAYLIST_ID}/${path.relative(
        playlistPath,
        thumbnailPath
      )}`,
    });

    // await sendMessage(queueChannel, "assign-previews", {
    //   transcodeId: TRANSCODE_ID,
    //   externalId: EXTERNAL_ID,
    //   previewsKey: `${PLAYLIST_ID}/${path.relative(
    //     playlistPath,
    //     previewsOutput
    //   )}`,
    // });

    await sendMessage(queueChannel, "transcode-status", {
      status: "COMPLETED",
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });

    await sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Uploaded",
      group: "UPLOAD",
      startAt: uploadStartAt,
      endAt: Date.now(),
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
    });

    // await fsPromises.rm(tmpDir, { recursive: true });

    await new Promise((resolve) => setTimeout(resolve, 500));

    sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Process completed successfully",
      startAt: probeStartAt,
      endAt: Date.now(),
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
      ts: Date.now(),
      group: "RESULT",
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    process.exit(0);
  });

  ffmpeg.on("start", (command: string) => {
    // console.log("FFmpeg command: ", command);

    sendMessage(queueChannel, "transcode-status", {
      status: "TRANSCODING_SPLITTING",
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });

    sendMessage(queueChannel, "transcode-log", {
      type: "LOG",
      content: "Start processing video...",
      group: "TRANSCODE",
      startAt: processingVideoStartAt,
      command,
      transcodeId: TRANSCODE_ID,
      externalId: EXTERNAL_ID,
    });
  });

  ffmpeg.run();
}

init();

// async function test() {
//   const previewsPath = path.resolve(tmpDir, "previews");

//   const result = await generatePreviewsFile(previewsPath);

//   console.log(result);
// }

// test();

/*
{
  index: 0,
  codec_name: "hevc",
  codec_long_name: "H.265 / HEVC (High Efficiency Video Coding)",
  profile: "Main 10",
  codec_type: "video",
  codec_tag_string: "[0][0][0][0]",
  codec_tag: "0x0000",
  width: 3840,
  height: 1920,
  coded_width: 3840,
  coded_height: 1920,
  closed_captions: 0,
  film_grain: 0,
  has_b_frames: 4,
  sample_aspect_ratio: "1:1",
  display_aspect_ratio: "2:1",
  pix_fmt: "yuv420p10le",
  level: 150,
  color_range: "tv",
  color_space: "bt2020nc",
  color_transfer: "smpte2084",
  color_primaries: "bt2020",
  chroma_location: "topleft",
  field_order: "unknown",
  refs: 1,
  id: "N/A",
  r_frame_rate: "24000/1001",
  avg_frame_rate: "24000/1001",
  time_base: "1/1000",
  start_pts: 0,
  start_time: 0,
  duration_ts: "N/A",
  duration: "N/A",
  bit_rate: "N/A",
  max_bit_rate: "N/A",
  bits_per_raw_sample: "N/A",
  nb_frames: "N/A",
  nb_read_frames: "N/A",
  nb_read_packets: "N/A",
  extradata_size: 177,
  tags: {
    language: "eng",
    BPS: "24144108",
    DURATION: "01:09:15.776000000",
    NUMBER_OF_FRAMES: "99638",
    NUMBER_OF_BYTES: "12542188569",
    _STATISTICS_WRITING_APP: "mkvmerge v61.0.0 ('So') 64-bit",
    _STATISTICS_TAGS: "BPS DURATION NUMBER_OF_FRAMES NUMBER_OF_BYTES",
  },
  disposition: {
    default: 1,
    dub: 0,
    original: 0,
    comment: 0,
    lyrics: 0,
    karaoke: 0,
    forced: 0,
    hearing_impaired: 0,
    visual_impaired: 0,
    clean_effects: 0,
    attached_pic: 0,
    timed_thumbnails: 0,
    non_diegetic: 0,
    captions: 0,
    descriptions: 0,
    metadata: 0,
    dependent: 0,
    still_image: 0,
  },
}
*/

// .filter(
//   (stream) =>
//     stream.codec_type === "audio" ||
//     (stream.codec_type === "video" && stream.is_avc)
// )
// async function init() {
//   if (!fs.existsSync(tmpDir)) {
//     fs.mkdirSync(tmpDir);
//   }

//   const s3 = new S3Client({ region: process.env.AWS_REGION });

//   Ffmpeg.setFfmpegPath(path.resolve(import.meta.dir, "bin", "ffmpeg"));
//   Ffmpeg.setFfprobePath(path.resolve(import.meta.dir, "bin", "ffprobe"));

//   const BUCKET = process.env.AWS_S3_BUCKET;
//   const OBJECT_KEY = process.env.TRANSCODER_S3_OBJECT_KEY;

//   if (!OBJECT_KEY) throw new Error("Object key not found");

//   const getObjectCommand = new GetObjectCommand({
//     Bucket: BUCKET,
//     Key: OBJECT_KEY,
//   });

//   const previewId = uuid();
//   const previewDir = `${path.resolve(import.meta.dir, "tmp", previewId)}`;

//   if (!fs.existsSync(previewDir)) {
//     await new Promise((resolve, error) => {
//       fs.mkdir(previewDir, {}, (err) => {
//         if (err) return error(err);

//         resolve(true);
//       });
//     });
//   }

//   // const fileStream = Readable.fromWeb(responseWebStream as any);

//   const videoPath = path.resolve(tmpDir, previewDir, OBJECT_KEY);

//   console.log("Starting dowload...");

//   const download = await downloadInChunks({
//     bucket: BUCKET as string,
//     key: OBJECT_KEY,
//     s3Client: s3,
//     outputPath: videoPath,
//   });

//   console.log("Get video metadata");
//   const videoProbe = await probe(fs.createReadStream(videoPath));

//   const ffmpeg = Ffmpeg();

//   ffmpeg.addInput(fs.createReadStream(videoPath));

//   const streams = await Promise.all(
//     videoProbe.streams
//       .filter(
//         (stream) =>
//           stream.codec_type === "audio" ||
//           (stream.codec_type === "video" && stream.is_avc)
//       )
//       .map((stream) => {
//         console.log(stream.index, stream.codec_type, stream.is_avc);

//         const streamId = uuid();

//         if (stream.codec_type === "video") {
//           const streamOutputPath = path.resolve(previewDir, `${streamId}.mp4`);

//           ffmpeg
//             .addOutput(streamOutputPath)
//             .outputFormat("mp4")
//             .addOptions(
//               "-an",
//               "-map",
//               "0:" + stream.index,
//               "-vf",
//               "scale=0.5*iw:0.5*ih,setpts=0.1*PTS,framerate=5"
//             );

//           return { id: streamId, type: "VIDEO" };
//         } else if (stream.codec_type === "audio") {
//           const streamOutputPath = path.resolve(previewDir, `${streamId}.m4a`);
//           ffmpeg
//             .addOutput(streamOutputPath)
//             .outputFormat("mp4")
//             .addOptions("-map", "0:" + stream.index, "-vn", "-acodec", "aac");

//           return { id: streamId, type: "AUDIO" };
//         }
//       })
//   );

//   ffmpeg.on("progress", function (progress) {
//     console.log(
//       `Processing${progress.percent ? ` ${progress.percent}%` : ""}: ${
//         progress.frames
//       } - ${progress.currentFps} - TargetSize: ${
//         progress.targetSize
//       } - Timemark: ${progress.timemark}`
//     );
//   });
//   ffmpeg.on("error", console.error);

//   ffmpeg.on("end", () => {
//     console.log("Transcode finished");
//     process.exit(0);
//   });

//   ffmpeg.on("start", (command: string) => {
//     console.log("FFmpeg command: ", command);
//   });

//   console.log("Starting transcode");
//   ffmpeg.run();
// }

// "environment": [
//   {
//     "name": "TRANSCODER_S3_OBJECT_KEY",
//     "value": "video2.mkv"
//   },{
//     "name": "PLAYLIST_ID",
//     "value": "videotoper3"
//   },{
//     "name": "AWS_REGION",
//     "value": "us-east-1"
//   },{
//     "name": "AWS_S3_BUCKET",
//     "value": "vps"
//   },{
//     "name": "AWS_ACCESS_KEY_ID",
//     "value": "LKIAQAAAAAAAD53NUIW4"
//   },{
//     "name": "AWS_SECRET_ACCESS_KEY",
//     "value": "/oor3T4vqiRIqHNMF8tLqvgHrmfclObKJrFCGZxj"
//   },{
//     "name": "AWS_ENDPOINT",
//     "value": "http://localhost:4566"
//   }
// ],
