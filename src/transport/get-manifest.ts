import axios from "axios";
import { getEnv } from "../utils/get-env";

type ManifestResponse = {
  // BUCKET: string;
  // ENCRYPTION_KEY_ID: string;
  // ENCRYPTION_KEY_VALUE: string;
  // TRANSCODE_ID: string;
  // EXTERNAL_ID: string;
  // PLAYLIST_ID: string;
  FOLDER?: string;
  OBJECT_KEY: string;
  BUCKET: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_ENDPOINT: string;
};

export const getManifest = async () => {
  const { MANIFEST_URL, TOKEN } = getEnv();

  const response = await axios
    .get<ManifestResponse>(MANIFEST_URL, { params: { token: TOKEN } })
    .then((response) => response.data);

  return response;
  // BUCKET,
  // ENCRYPTION_KEY_ID,
  // ENCRYPTION_KEY_VALUE,
  // TRANSCODE_ID,
  // EXTERNAL_ID,
  // OBJECT_KEY,
  // PLAYLIST_ID
};
