import axios from "axios";
import { getEnv } from "../utils/get-env";

type Log = {
  content: string;
  group: string;
};

export const log = async (data: Log) => {
  const ts = Date.now();

  console.log(`(${ts}) [${data.group}] ${data.content}`);

  const { TRANSPORT, LOGGER_URL, TOKEN } = getEnv();

  if (TRANSPORT === "HTTP") {
    if (!LOGGER_URL) return console.log("Logger not found");

    await axios
      .post(LOGGER_URL, {
        token: TOKEN,
        data: { ...data, timestamp: Date.now() },
      })
      .catch((e) => console.log("Error while updating transcode data", e));

    return;
  }

  // const channel = await getChannel();

  // if (!channel) return;

  // channel.sendToQueue(
  //   RMQ_QUEUE,
  //   Buffer.from(
  //     JSON.stringify({
  //       pattern: "transcode-log",
  //       data: {
  //         ...data,
  //         ts,
  //         transcodeId: TRANSCODE_ID,
  //         externalId: EXTERNAL_ID,
  //         type: "LOG",
  //       },
  //     })
  //   )
  // );

  // await new Promise((resolve) => setTimeout(resolve, 250));
};
