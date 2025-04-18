import Ffmpeg from "fluent-ffmpeg";
import * as path from "path";

console.log(import.meta.dir);

Ffmpeg.setFfprobePath(path.resolve(import.meta.dir, "..", "bin", "ffprobe"));

export const probe = async (stream: string): Promise<Ffmpeg.FfprobeData> => {
  return new Promise((resolve, error) => {
    Ffmpeg(stream).ffprobe((err, data) => {
      if (err) return error(err);

      resolve(data);
    });
  });
};
