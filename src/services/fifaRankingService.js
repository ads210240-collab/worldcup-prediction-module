import { cacheTtl, withCache } from "./cacheService.js";
import { rankingSeeds } from "./mockData.js";
import { buildSourceStatus } from "./sourceUtils.js";
import { canonicalTeamName, translateTeamName } from "./translationService.js";

function getSeedRanking(teamName) {
  const canonical = canonicalTeamName(teamName);
  return rankingSeeds[teamName] || rankingSeeds[canonical] || { rank: null, elo: null };
}

export async function getFifaRankings(teamNames) {
  return withCache(`fifa-ranking:v2:${teamNames.sort().join("|")}`, cacheTtl.teamStats, async () => {
    const rankingsByTeam = Object.fromEntries(
      teamNames.map((teamName) => {
        const seed = getSeedRanking(teamName);
        return [
          teamName,
          {
            teamName: translateTeamName(teamName),
            rank: seed.rank,
            source: seed.rank ? "FIFA Ranking seed" : "FIFA Ranking unavailable",
            estimated: true,
          },
        ];
      }),
    );

    return {
      rankingsByTeam,
      sourceStatuses: [
        buildSourceStatus({
          source: "FIFA Ranking",
          ok: true,
          count: teamNames.length,
          error: "official ranking API unavailable in free mode; using manually maintained seed",
        }),
      ],
    };
  });
}
