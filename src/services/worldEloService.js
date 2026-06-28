import { cacheTtl, withCache } from "./cacheService.js";
import { rankingSeeds } from "./mockData.js";
import { buildSourceStatus, fetchTextWithMeta } from "./sourceUtils.js";
import { canonicalTeamName, translateTeamName } from "./translationService.js";

const WORLD_ELO_URL = process.env.WORLD_ELO_URL || "https://www.eloratings.net";

function getSeedElo(teamName) {
  const canonical = canonicalTeamName(teamName);
  return rankingSeeds[teamName]?.elo || rankingSeeds[canonical]?.elo || null;
}

function parseEloPage(html, teamNames) {
  const ratings = {};

  for (const teamName of teamNames) {
    const canonical = canonicalTeamName(teamName);
    const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`${escaped}[\\s\\S]{0,120}?([12][0-9]{3})`, "i"));
    if (match) {
      ratings[teamName] = Number(match[1]);
    }
  }

  return ratings;
}

export async function getWorldEloRatings(teamNames) {
  return withCache(`world-elo:v2:${teamNames.sort().join("|")}`, cacheTtl.teamStats, async () => {
    const sourceStatuses = [];
    let liveRatings = {};

    try {
      const { data, meta } = await fetchTextWithMeta(WORLD_ELO_URL);
      liveRatings = parseEloPage(data, teamNames);
      sourceStatuses.push(
        buildSourceStatus({
          source: "World Football Elo Ratings",
          ok: Object.keys(liveRatings).length > 0,
          count: Object.keys(liveRatings).length,
          meta,
          error: Object.keys(liveRatings).length ? "" : "no matching team ratings parsed",
        }),
      );
    } catch (error) {
      sourceStatuses.push(
        buildSourceStatus({
          source: "World Football Elo Ratings",
          ok: false,
          error: error instanceof Error ? error.message : "failed",
          meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
        }),
      );
    }

    const eloByTeam = Object.fromEntries(
      teamNames.map((teamName) => {
        const liveElo = liveRatings[teamName];
        const seedElo = getSeedElo(teamName);
        return [
          teamName,
          {
            teamName: translateTeamName(teamName),
            elo: liveElo || seedElo,
            source: liveElo ? "World Football Elo Ratings" : seedElo ? "World Football Elo seed" : "World Football Elo unavailable",
            estimated: !liveElo,
          },
        ];
      }),
    );

    return { eloByTeam, sourceStatuses };
  });
}
