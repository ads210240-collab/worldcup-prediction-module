import { cacheTtl, withCache } from "./cacheService.js";
import { buildSourceStatus, fetchTextWithMeta } from "./sourceUtils.js";
import { getTeamAliases, translateNewsText } from "./translationService.js";

const NEWS_FEEDS = [
  {
    source: "ESPN",
    url: process.env.ESPN_SOCCER_RSS_URL || "https://www.espn.com/espn/rss/soccer/news",
  },
  {
    source: "BBC Sport",
    url: process.env.BBC_SPORT_RSS_URL || "https://feeds.bbci.co.uk/sport/football/rss.xml",
  },
  {
    source: "Goal.com",
    url: process.env.GOAL_RSS_URL || "https://www.goal.com/feeds/en/news",
  },
  {
    source: "Yahoo Sports",
    url: process.env.YAHOO_SPORTS_RSS_URL || "https://sports.yahoo.com/soccer/rss.xml",
  },
  {
    source: "Google News",
    url:
      process.env.GOOGLE_NEWS_RSS_URL ||
      "https://news.google.com/rss/search?q=football%20world%20cup%20when:1d&hl=en-US&gl=US&ceid=US:en",
  },
];

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function getTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

function parseRss(xml, source) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([item]) => ({
    source,
    title: translateNewsText(getTag(item, "title")),
    originalTitle: getTag(item, "title"),
    link: getTag(item, "link"),
    description: translateNewsText(getTag(item, "description")),
    originalDescription: getTag(item, "description"),
    publishedAt: getTag(item, "pubDate") || getTag(item, "updated"),
  }));
}

function isRecent(item) {
  if (!item.publishedAt) return true;
  const publishedMs = new Date(item.publishedAt).getTime();
  if (Number.isNaN(publishedMs)) return true;
  return Date.now() - publishedMs <= 24 * 60 * 60 * 1000;
}

function matchesFixture(item, fixture) {
  const text = `${item.title} ${item.description} ${item.originalTitle} ${item.originalDescription}`.toLowerCase();
  const teams = [fixture.homeTeam, fixture.awayTeam, fixture.originalHomeTeam, fixture.originalAwayTeam].flatMap(getTeamAliases);
  return teams.some((team) => team.length > 3 && text.includes(team)) || text.includes("world cup") || text.includes("fifa");
}

export async function getNews(fixtures) {
  return withCache("news:v2", cacheTtl.news, async () => {
    const sourceStatuses = [];
    const newsItems = [];

    for (const feed of NEWS_FEEDS) {
      try {
        const { data, meta } = await fetchTextWithMeta(feed.url);
        const parsed = parseRss(data, feed.source).filter(isRecent);
        sourceStatuses.push(buildSourceStatus({ source: feed.source, ok: parsed.length > 0, count: parsed.length, meta }));
        newsItems.push(...parsed);
      } catch (error) {
        sourceStatuses.push(
          buildSourceStatus({
            source: feed.source,
            ok: false,
            error: error instanceof Error ? error.message : "failed",
            meta: { httpStatus: error.httpStatus, responseTimeMs: error.responseTimeMs },
          }),
        );
      }
    }

    const newsByMatchId = Object.fromEntries(
      fixtures.map((fixture) => {
        const items = newsItems.filter((item) => matchesFixture(item, fixture)).slice(0, 5);
        return [fixture.id, items];
      }),
    );

    return {
      newsByMatchId,
      sourceStatuses,
      sources: NEWS_FEEDS.map((feed) => feed.source),
    };
  });
}
