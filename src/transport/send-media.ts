import axios from "axios";
import { getEnv } from "../utils/get-env";

type Data = {
  key: string;
  manifestKey: string;
  encryption: {
    keyId: string;
    keyValue: string;
  };
  origin: "SHAKA-PACKAGER" | "BENTO4-MP4DASH";
  type: "DASH" | "HLS";
  streams: {
    originalId: number;
    codec: string;
    duration: number;
    language: string | null;
    channels: number | null;
    bitRate: number;
    bufSize?: string;
  }[];
  thumbnailKey: string;
  previewsKey: string;
};

export const sendMedia = async (data: Data) => {
  const { MEDIA_CENTER_URL, TOKEN } = getEnv();

  if (!MEDIA_CENTER_URL) return console.log("MEDIA CENTER NOT FOUND");

  await axios
    .post(MEDIA_CENTER_URL, {
      token: TOKEN,
      data: data,
    })
    .catch((e) => console.log("Error while sending media object", data, e));
};
