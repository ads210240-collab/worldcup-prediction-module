import { cacheTtl, withCache } from "./cacheService.js";
import { buildSourceStatus } from "./sourceUtils.js";
import { getFifaRankings } from "./fifaRankingService.js";
import { getWorldEloRatings } from "./worldEloService.js";
import { fetchFootballDataMatches } from "./footballDataService.js";
import { fetchEspnScoreboard } from "./espnScoreboardService.js";
import { formatEspnDate, formatTaipeiDate } from "./timeService.js";

const FOOTBALL_SEASON = process.env.FOOTBALL_SEASON || "2026";
const TOURNAMENT_START_DATE = process.env.FOOTBALL_TOURNAMENT_START_DATE || `${FOOTBALL_SEASON}-06-01`;
const TOURNAMENT_LOOKBACK_DAYS = Number(process.env.FOOTBALL_TOURNAMENT_LOOKBACK_DAYS || 35);

function inferTournamentPhase(fixtures) {
  const stageText = fixtures
    .map((fixture) => `${fixture.providerMeta?.stage || ""} ${fixture.providerMeta?.round || ""} ${fixture.competition || ""}`)
    .join(" ")
    .toLowerCase();

  if (stageText.includes("round_of_32") || stageText.includes("32")) return "32 強";
  if (stageText.includes("round_of_16") || stageText.includes("16")) return "16 強";
  if (stageText.includes("quarter") || stageText.includes("semi") || stageText.includes("final")) return "淘汰賽";
  return "小組賽";
}

function inferTournamentStatus(stats) {
  if (!stats.played) return "尚未出賽";
  if (stats.played >= 3 && stats.record.wins >= 2) return "晉級機率高";
  if (stats.played >= 3 && stats.record.losses >= 2 && stats.goalDifference < 0) return "淘汰風險高";
  return "競爭中";
}

function summarizeTournamentStats(teamName, completedFixtures) {
  const matches = completedFixtures
    .filter((fixture) => fixture.homeTeam === teamName || fixture.awayTeam === teamName)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let homeMatches = 0;
  let awayMatches = 0;

  for (const match of matches) {
    const isHome = match.homeTeam === teamName;
    const own = isHome ? match.score.home : match.score.away;
    const against = isHome ? match.score.away : match.score.home;
    if (own == null || against == null) continue;

    if (isHome) homeMatches += 1;
    else awayMatches += 1;

    goalsFor += own;
    goalsAgainst += against;

    if (own > against) wins += 1;
    else if (own === against) draws += 1;
    else losses += 1;
  }

  const played = matches.length;
  const goalDifference = goalsFor - goalsAgainst;
  const goalsForPerGame = played ? Number((goalsFor / played).toFixed(2)) : 0;
  const goalsAgainstPerGame = played ? Number((goalsAgainst / played).toFixed(2)) : 0;
  const record = { wins, draws, losses };
  const formText = played
    ? `${wins} 勝 ${draws} 和 ${losses} 敗，進 ${goalsFor} 球、失 ${goalsAgainst} 球`
    : "本屆尚無比賽數據，改用排名 / Elo / 新聞資料輔助估算";

  return {
    played,
    sampleSize: played,
    record,
    goalsFor,
    goalsAgainst,
    goalsForPerGame,
    goalsAgainstPerGame,
    goalDifference,
    homeMatches,
    awayMatches,
    phase: inferTournamentPhase(matches),
    groupRank: played ? "免費來源未提供小組排名" : "尚無排名",
    advancementStatus: inferTournamentStatus({ played, record, goalDifference }),
    strengthContext: played
      ? goalDifference >= 2
        ? "本屆面對對手時攻守效率偏強"
        : goalDifference <= -2
          ? "本屆面對對手時防守壓力偏高"
          : "本屆對戰表現接近均勢"
      : "尚無本屆對戰樣本",
    formText,
  };
}

function uniqueFixtures(fixtures) {
  const seen = new Set();
  return fixtures.filter((fixture) => {
    const key = fixture.id || `${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTournamentDates() {
  const today = new Date();
  const requestedStart = new Date(`${TOURNAMENT_START_DATE}T00:00:00+08:00`);
  const lookbackStart = new Date(today.getTime() - TOURNAMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const start = requestedStart > lookbackStart ? requestedStart : lookbackStart;
  const dates = [];

  for (let cursor = new Date(start); cursor <= today; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push(new Date(cursor));
  }

  return dates;
}

export async function getTeamStats(fixtures) {
  return withCache("team-stats:v2", cacheTtl.teamStats, async () => {
    const sourceStatuses = [];
    let supplementalFixtures = [];

    try {
      const today = new Date();
      const { fixtures: footballDataFixtures, metas } = await fetchFootballDataMatches({
        dateFrom: formatTaipeiDate(new Date(`${TOURNAMENT_START_DATE}T00:00:00+08:00`)),
        dateTo: formatTaipeiDate(today),
      });
      supplementalFixtures = footballDataFixtures;
      sourceStatuses.push(
        buildSourceStatus({
          source: "football-data.org 本屆賽事資料",
          ok: footballDataFixtures.length > 0,
          count: footballDataFixtures.length,
          meta: metas[metas.length - 1] || {},
        }),
      );
    } catch (error) {
      sourceStatuses.push(
        buildSourceStatus({
          source: "football-data.org 本屆賽事資料",
          ok: false,
          error: error instanceof Error ? error.message : "failed",
          meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
        }),
      );
    }

    try {
      const dates = getTournamentDates();
      const results = await Promise.all(
        dates.map((date) =>
          fetchEspnScoreboard(formatEspnDate(date)).catch((error) => ({
            fixtures: [],
            meta: {
              ok: false,
              error: error instanceof Error ? error.message : "failed",
              httpStatus: error.httpStatus,
              responseTimeMs: error.responseTimeMs,
            },
          })),
        ),
      );
      const espnTournamentFixtures = results.flatMap((result) => result.fixtures || []);
      supplementalFixtures = uniqueFixtures([...supplementalFixtures, ...espnTournamentFixtures]);
      const failed = results.filter((result) => result.meta?.ok === false).length;
      sourceStatuses.push(
        buildSourceStatus({
          source: "ESPN Scoreboard 本屆歷史賽事",
          ok: espnTournamentFixtures.length > 0,
          count: espnTournamentFixtures.length,
          meta: {
            cacheHit: false,
            responseTimeMs: results.reduce((sum, result) => sum + (result.meta?.responseTimeMs || 0), 0),
            error: failed ? `${failed} days failed` : null,
          },
        }),
      );
    } catch (error) {
      sourceStatuses.push(
        buildSourceStatus({
          source: "ESPN Scoreboard 本屆歷史賽事",
          ok: false,
          error: error instanceof Error ? error.message : "failed",
          meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
        }),
      );
    }

    const completedFixtures = uniqueFixtures([...fixtures, ...supplementalFixtures]).filter((fixture) => {
      const status = String(fixture.status || "").toUpperCase();
      return status === "FINISHED" || status.includes("FULL_TIME") || status.includes("FINAL") || fixture.providerMeta?.state === "post";
    });
    const teams = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]))];
    const fifa = await getFifaRankings([...teams]);
    const elo = await getWorldEloRatings([...teams]);

    const statsByTeam = Object.fromEntries(
      teams.map((teamName) => {
        const tournament = summarizeTournamentStats(teamName, completedFixtures);
        const fifaRanking = fifa.rankingsByTeam[teamName] || { rank: null, estimated: true };
        const eloRating = elo.eloByTeam[teamName] || { elo: null, estimated: true };
        const estimated = tournament.played === 0 || fifaRanking.estimated || eloRating.estimated;
        return [
          teamName,
          {
            teamName,
            tournament,
            recent: tournament,
            ranking: {
              rank: fifaRanking.rank || 80,
              elo: eloRating.elo || 1500,
              fifaSource: fifaRanking.source,
              eloSource: eloRating.source,
              fifaEstimated: Boolean(fifaRanking.estimated),
              eloEstimated: Boolean(eloRating.estimated),
            },
            homeAway: {
              home: tournament.homeMatches,
              away: tournament.awayMatches,
            },
            source: tournament.played ? "tournament-fixtures-derived" : "ranking-estimate",
            dataQuality: {
              estimated,
              tournamentSampleSize: tournament.played,
              recentSampleSize: tournament.played,
              missingSources: [
                tournament.played === 0 ? "current-tournament" : "",
                fifaRanking.estimated ? "fifa-ranking" : "",
                eloRating.estimated ? "world-elo" : "",
              ].filter(Boolean),
            },
            limitations: [
              tournament.played === 0 ? "本屆尚無比賽數據，改用排名 / Elo / 新聞資料輔助估算" : "",
              fifaRanking.estimated ? "FIFA Ranking 使用 seed 或手動維護資料" : "",
              eloRating.estimated ? "World Football Elo 使用 seed 或解析失敗後估算" : "",
            ].filter(Boolean),
          },
        ];
      }),
    );

    return {
      statsByTeam,
      sourceStatuses: [
        ...sourceStatuses,
        buildSourceStatus({
          source: "本屆賽事數據",
          ok: completedFixtures.length > 0,
          count: completedFixtures.length,
        }),
        buildSourceStatus({
          source: "home/away split",
          ok: true,
          count: teams.length,
        }),
        ...fifa.sourceStatuses,
        ...elo.sourceStatuses,
      ],
    };
  });
}
