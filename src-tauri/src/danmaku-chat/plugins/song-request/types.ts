export interface SongQueueItem {
  requestId: number;
  uid: number;
  uname: string;
  songName: string;
  artistNames: string;
  tier: string;
  creditValue: number;
  priorityScore: number;
  status: string;
  requestedAt: string;
}

export interface SongQueueResponse {
  items: SongQueueItem[];
}

export interface NowPlayingResponse {
  item: SongQueueItem | null;
}

export interface RankResponse {
  items: Array<{ uname?: string; value?: number; count?: number; tier?: string }>;
}

export interface SongRequestVisualState {
  newRequestIds: Set<number>;
  playingChanged: boolean;
  highTierRequestId: number | null;
}
