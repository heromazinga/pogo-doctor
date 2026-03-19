import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 3; // 3시간 캐시

// ScrapedDuck 이벤트 타입 → 한국어 라벨 + 이모지
const EVENT_TYPE_MAP = {
  "community-day":        { label: "커뮤니티 데이", emoji: "🌟", priority: true },
  "raid-day":             { label: "레이드 데이",   emoji: "⚔️", priority: true },
  "raid-hour":            { label: "레이드 아워",   emoji: "⚔️", priority: true },
  "spotlight-hour":       { label: "스포트라이트",  emoji: "💡", priority: false },
  "event":                { label: "이벤트",        emoji: "🎉", priority: true },
  "season":               { label: "시즌",          emoji: "📅", priority: false },
  "go-battle-league":     { label: "GO 배틀리그",   emoji: "🏆", priority: false },
  "go-fest":              { label: "GO 페스트",     emoji: "🎪", priority: true },
  "research-breakthrough":{ label: "돌파 연구",     emoji: "🔬", priority: false },
  "pokemon-go-tour":      { label: "포켓몬GO 투어", emoji: "🎡", priority: true },
};

function getEventType(typeStr) {
  if (!typeStr) return { label: "이벤트", emoji: "🎉", priority: false };
  const key = typeStr.toLowerCase().replace(/\s+/g, "-");
  // 부분 매칭
  for (const [mapKey, val] of Object.entries(EVENT_TYPE_MAP)) {
    if (key.includes(mapKey)) return val;
  }
  return { label: typeStr, emoji: "📌", priority: false };
}

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json",
      { next: { revalidate: 0 } }
    );
    if (!res.ok) {
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 502 });
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: "Unexpected data format" }, { status: 500 });
    }

    const now = Date.now();

    const events = data
      .map((e) => {
        const start = e.start ? new Date(e.start).getTime() : 0;
        const end   = e.end   ? new Date(e.end).getTime()   : 0;
        const typeInfo = getEventType(e.eventType);

        return {
          name:     e.heading || e.name || "이벤트",
          link:     e.link || null,
          start,
          end,
          eventType:  e.eventType || "",
          label:    typeInfo.label,
          emoji:    typeInfo.emoji,
          priority: typeInfo.priority,
          isActive:   start <= now && (end === 0 || end >= now),
          isUpcoming: start > now,
          image:    e.image || null,
        };
      })
      // 현재 진행중 + 앞으로 2주 이내 이벤트만
      .filter((e) => {
        const twoWeeks = now + 1000 * 60 * 60 * 24 * 14;
        return e.isActive || (e.isUpcoming && e.start <= twoWeeks);
      })
      // 진행중 먼저, 그다음 시작 순
      .sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.start - b.start;
      });

    cache = events;
    cacheTime = Date.now();
    return NextResponse.json(events);
  } catch (e) {
    if (cache) return NextResponse.json(cache);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
