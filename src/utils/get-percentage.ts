import { timemarkToSeconds } from "./timemark-to-seconds";

export const getPercentage = (
  data: {
    frames: number;
    currentFps: number;
    currentKbps: number;
    targetSize: number;
    timemark: string;
    percent?: number | undefined;
  },
  duration: number
) => {
  if (data.percent) return parseFloat(data.percent.toFixed(2));

  const percent =
    duration <= 0 ? 0 : (timemarkToSeconds(data.timemark) / duration) * 100;

  return parseFloat(percent.toFixed(2));
};
