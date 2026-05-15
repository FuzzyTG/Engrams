export type Topic = {
  file: string;
  title: string;
  created: string;
  origin: string;
  last_seen: string;
  weight: number;
  participants: string[];
  evergreen: boolean;
  body: string;
};

export type IndexEntry = {
  file: string;
  title: string;
  weight: number;
  origin: string;
  last_seen: string;
  participants: string[];
  evergreen: boolean;
};

export type SelectedTopic = {
  file: string;
  title: string;
  weight: number;
  tier: 1 | 2;
};

export type SelectionInput = {
  index: IndexEntry[];
  agentId: string;
  timeWindowHours: number;
  topN: number;
  now: Date;
};

export type RenderInput = {
  selectedTopics: SelectedTopic[];
  engramsPath: string;
  maxBytes: number;
};
