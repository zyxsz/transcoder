export type TrackType = "VIDEO" | "AUDIO" | "SUBTITLE";

export type Track = {
  index: number;
  codec: string;

  duration: number;
  language: string | null;
  isForced: boolean | null;
  type: TrackType;

  channels: number;
  bitRate: number;
  bufSize?: string;
};

export type FinalTrack = {
  key: string;
  path: string;
  originalTrack: Track;
  stream: {
    originalId: number;
    codec: string;
    duration: number;
    language: string | null;
    channels: number | null;
    bitRate: number;
    bufSize?: string;
  };
};
