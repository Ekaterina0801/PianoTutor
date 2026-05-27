import type { NoteEvent } from "@/lib/types";

export type MatchStatus = "correct" | "extra" | "missed";

export type MatchRow = {
  status: MatchStatus;
  performed: NoteEvent | null;
  expected: NoteEvent | null;
  dt_onset_s: number | null;
};

export type SessionDetails = {
  id: string;
  exercise_id: string;
  created_at: string;
  source: "midi" | "mic";
  metrics: any;
  pipeline?: any;
  events: {
    expected?: NoteEvent[];
    performed?: NoteEvent[];
    matches?: MatchRow[];
  };
};
