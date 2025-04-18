import axios from "axios";
import { getEnv } from "../utils/get-env";
import { getChannel } from "./get-channel";

type Status =
  | "COMPLETED"
  | "TRANSCODING_SPLITTING"
  | "DOWNLOADING"
  | "FETCHING_METADATA"
  | "TRANSCODE_ERROR"
  | "FRAGMENTING"
  | "GENERATING_MANIFEST"
  | "UPLOADING";

export const updateStatus = async (status: Status) => {
  const ts = Date.now();

  console.log(`(${ts}) [UPDATE_STATUS] ${status}`);

  const { TRANSPORT, TRANSCODES_API_URL, TOKEN } = getEnv();

  if (TRANSPORT === "HTTP") {
    if (!TRANSCODES_API_URL) return console.log("Api not found");

    await axios
      .put(TRANSCODES_API_URL, { token: TOKEN, data: { status } })
      .catch((e) => console.log("Error while updating status", e));

    return;
  }
};
