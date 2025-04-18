import * as path from "path";
import * as fsPromises from "fs/promises";
import { createGzip } from "zlib";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";

export const generatePreviewsFile = async (
  dirPath: string,
  outputFile: string
) => {
  const files = await fsPromises.readdir(dirPath);

  const filesInBase64 = await Promise.all(
    files.map(async (file) => {
      const number = parseInt(file.replaceAll(".jpg", "")) - 1;

      const base64 = await fsPromises.readFile(
        path.resolve(dirPath, file),
        "base64"
      );

      return {
        count: number + 1,
        startAt: number * 10,
        endAt: number * 10 + 9,
        data: `data:image/jpeg;base64,${base64}`,
      };
    })
  );

  await fsPromises.writeFile(outputFile, JSON.stringify(filesInBase64));

  return;
};
