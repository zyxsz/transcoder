import amqplib from "amqplib";
import { getEnv } from "../utils/get-env";

let channel: amqplib.Channel;

export const getChannel = async () => {
  // if (channel) return channel;

  return null;

  // const { RMQ_URL, TRANSPORT } = getEnv();

  // if (TRANSPORT === "HTTP") return null;

  // const queueConnection = await amqplib.connect(RMQ_URL).catch(() => null);

  // if (!queueConnection) return null;

  // const queueChannel = await queueConnection.createChannel().catch(() => null);

  // if (!queueChannel) return null;

  // channel = queueChannel;

  // return queueChannel;
};
