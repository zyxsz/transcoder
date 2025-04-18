import amqplib from "amqplib";

export const sendMessage = async (
  channel: amqplib.Channel | any,
  pattern: string,
  data: object
) => {
  const RMQ_QUEUE = process.env.RMQ_QUEUE as string;

  channel.sendToQueue(
    RMQ_QUEUE,
    Buffer.from(JSON.stringify({ pattern: pattern || "transcode-log", data }))
  );

  await new Promise((resolve) => setTimeout(resolve, 250));
};
