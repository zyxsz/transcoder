import { getEnv } from "../utils/get-env";
import { getChannel } from "./get-channel";

export const sendMessage = async <T>(pattern: string, data: T) => {
  const ts = Date.now();

  console.log(`(${ts}) [SEND_MESSAGE] ${pattern} -> ${JSON.stringify(data)}`);

  // const { TRANSPORT, LOGGER_URL, RMQ_QUEUE, TRANSCODE_ID, EXTERNAL_ID } =
  //   getEnv();

  // if (TRANSPORT === "HTTP") {
  //   if (!LOGGER_URL) return console.log("Logger not found");

  //   return;
  // }

  // const channel = await getChannel();

  // if (!channel) return;

  // channel.sendToQueue(
  //   RMQ_QUEUE,
  //   Buffer.from(
  //     JSON.stringify({
  //       pattern,
  //       data: {
  //         transcodeId: TRANSCODE_ID,
  //         externalId: EXTERNAL_ID,
  //         ...data,
  //       },
  //     })
  //   )
  // );

  await new Promise((resolve) => setTimeout(resolve, 250));
};
