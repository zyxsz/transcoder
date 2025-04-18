export const getEnv = () => {
  // const USE_CUDA = false;
  // const TRANSCODE_ID = process.env.TRANSCODE_ID as string;
  // const EXTERNAL_ID = process.env.EXTERNAL_ID as string;
  // const OBJECT_KEY = process.env.KEY as string;

  // const RMQ_URL = process.env.RMQ_URL as string;
  // const RMQ_QUEUE = process.env.RMQ_QUEUE as string;

  // const BUCKET = process.env.AWS_S3_BUCKET as string;
  // const PLAYLIST_ID = process.env.PLAYLIST_ID as string;

  // const ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID as string;
  // const ENCRYPTION_KEY_VALUE = process.env.ENCRYPTION_KEY_VALUE as string;

  const TRANSPORT: "HTTP" | "RMQ" = (process.env.TRANSPORT as "HTTP") || "RMQ";
  const LOGGER_URL = process.env.LOGGER_URL || null;

  const MANIFEST_URL = process.env.MANIFEST_URL as string;
  const TOKEN = process.env.TOKEN as string;

  const TRANSCODES_API_URL = process.env.TRANSCODES_API_URL as string;

  const MEDIA_CENTER_URL = process.env.MEDIA_CENTER_URL as string;

  return {
    // USE_CUDA,
    // BUCKET,
    // ENCRYPTION_KEY_ID,
    // ENCRYPTION_KEY_VALUE,
    // TRANSCODE_ID,
    // EXTERNAL_ID,
    // OBJECT_KEY,
    // PLAYLIST_ID,
    // RMQ_URL,
    // RMQ_QUEUE,
    TOKEN,
    MANIFEST_URL,
    TRANSPORT,
    LOGGER_URL,
    TRANSCODES_API_URL,
    MEDIA_CENTER_URL,
  };
};
