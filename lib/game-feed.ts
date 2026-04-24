export type TeamSummary = {
  name: string;
  abbr: string;
  logo: string | null;
  color: string | null;
  alternateColor: string | null;
  score: string | null;
  record: string | null;
  linescores: string[];
  hits: string | null;
  errors: string | null;
};

export type GameAnalysisSummary = {
  analyzed: boolean;
  hasActivePick: boolean;
  pickId?: string | null;
  status: string;
  confidence: string | null;
  selection: string | null;
  market?: string | null;
  line?: number | null;
  odds?: number | null;
  probability?: number | null;
  edge?: number | null;
  ev?: number | null;
  updatedAt: string | null;
};

export type LiveGameParticipant = {
  id: string | null;
  name: string;
  shortName: string | null;
  teamAbbr: string | null;
  position: string | null;
  headshot: string | null;
  note: string | null;
};

export type LiveGameSituation = {
  venueName: string | null;
  lastPlay: string | null;
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  batter: LiveGameParticipant | null;
  pitcher: LiveGameParticipant | null;
};

export type GameFeedItem = {
  gameId: string;
  date: string | null;
  name: string;
  shortName: string;
  status: string;
  statusDetail: string;
  state: string;
  completed: boolean;
  innings: number;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  analysis: GameAnalysisSummary;
  liveSituation: LiveGameSituation | null;
};

export type GamesResponse = {
  ok: boolean;
  error?: string;
  games?: GameFeedItem[];
};

export function isGameLive(game: Pick<GameFeedItem, 'state' | 'completed'>) {
  return game.state === 'in' && !game.completed;
}

export function isPregameGame(game: Pick<GameFeedItem, 'state' | 'completed'>) {
  return !game.completed && game.state !== 'in';
}
