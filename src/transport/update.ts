import axios from "axios";
import { getEnv } from "../utils/get-env";
import { getChannel } from "./get-channel";

export const updateTranscode = async (data: {
  isRunning?: boolean;
  jobStartedAt?: string;
  jobEndedAt?: string;
}) => {
  const ts = Date.now();

  console.log(`(${ts}) [UPDATE_DATA] ${data}`);

  const { TRANSPORT, TRANSCODES_API_URL, TOKEN } = getEnv();

  if (TRANSPORT === "HTTP") {
    if (!TRANSCODES_API_URL) return console.log("Api not found");

    await axios
      .put(TRANSCODES_API_URL, { token: TOKEN, data })
      .catch((e) => console.log("Error while updating transcode data", e));

    return;
  }
};
