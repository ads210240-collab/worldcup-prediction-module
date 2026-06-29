const teamNameMap = {
  Algeria: "阿爾及利亞",
  Argentina: "阿根廷",
  Australia: "澳洲",
  Austria: "奧地利",
  Belgium: "比利時",
  Brazil: "巴西",
  Canada: "加拿大",
  Chile: "智利",
  Colombia: "哥倫比亞",
  Croatia: "克羅埃西亞",
  Denmark: "丹麥",
  Ecuador: "厄瓜多",
  England: "英格蘭",
  France: "法國",
  Germany: "德國",
  Ghana: "迦納",
  Haiti: "海地",
  Italy: "義大利",
  Japan: "日本",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Netherlands: "荷蘭",
  Norway: "挪威",
  Panama: "巴拿馬",
  Paraguay: "巴拉圭",
  Portugal: "葡萄牙",
  Scotland: "蘇格蘭",
  Senegal: "塞內加爾",
  "South Africa": "南非",
  Spain: "西班牙",
  Switzerland: "瑞士",
  "United States": "美國",
  USA: "美國",
  Uruguay: "烏拉圭",
  "Czech Republic": "捷克",
  "Congo DR": "剛果民主共和國",
  "Korea Republic": "韓國",
  "Saudi Arabia": "沙烏地阿拉伯",
  "New Zealand": "紐西蘭",
  Uzbekistan: "烏茲別克",
  Jordan: "約旦",
};

const reverseTeamNameMap = Object.fromEntries(Object.entries(teamNameMap).map(([english, chinese]) => [chinese, english]));

const phraseMap = [
  ["World Cup", "世界盃"],
  ["FIFA", "FIFA"],
  ["football", "足球"],
  ["soccer", "足球"],
  ["injury", "傷勢"],
  ["injured", "受傷"],
  ["doubt", "出賽成疑"],
  ["suspended", "停賽"],
  ["suspension", "停賽"],
  ["returns", "回歸"],
  ["return", "回歸"],
  ["win", "勝利"],
  ["loss", "敗仗"],
  ["draw", "和局"],
  ["coach", "教練"],
  ["squad", "陣容"],
  ["lineup", "先發名單"],
  ["form", "狀態"],
  ["prediction", "預測"],
  ["preview", "前瞻"],
  ["odds", "盤口"],
];

export function translateTeamName(name = "") {
  const normalized = String(name).trim();
  return teamNameMap[normalized] || normalized;
}

export function canonicalTeamName(name = "") {
  const normalized = String(name).trim();
  return reverseTeamNameMap[normalized] || normalized;
}

export function getTeamAliases(name = "") {
  const translated = translateTeamName(name);
  const canonical = canonicalTeamName(name);
  return [...new Set([name, translated, canonical].filter(Boolean).map((item) => String(item).toLowerCase()))];
}

export function translateNewsText(text = "") {
  let output = String(text || "");
  for (const [english, chinese] of Object.entries(teamNameMap)) {
    output = output.replace(new RegExp(`\\b${english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), chinese);
  }

  for (const [english, chinese] of phraseMap) {
    output = output.replace(new RegExp(`\\b${english}\\b`, "gi"), chinese);
  }

  return output;
}
