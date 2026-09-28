// AI 사용 횟수 날짜 계산 (클라이언트·서버 공용)
// Gemini 의 일일 요청 한도(RPD)는 태평양 시간 자정에 초기화된다 (ai.google.dev/gemini-api/docs/rate-limits 기준).
// 환경변수 AI_USAGE_TZ / NEXT_PUBLIC_AI_USAGE_TZ 로 바꿀 수 있다.

export const DEFAULT_USAGE_TZ = "America/Los_Angeles";

export function usageTimeZone() {
  return (typeof process !== "undefined" && (process.env.NEXT_PUBLIC_AI_USAGE_TZ || process.env.AI_USAGE_TZ)) || DEFAULT_USAGE_TZ;
}

// 해당 시간대 기준 오늘 날짜 "YYYY-MM-DD"
export function usageDate(now = new Date(), tz = usageTimeZone()) {
  return now.toLocaleDateString("sv-SE", { timeZone: tz });
}

// 한도 초기화(해당 시간대 다음 자정) 시각을 한국 시간 "HH:MM" 로
export function nextResetKST(now = new Date(), tz = usageTimeZone()) {
  // 시간대의 현재 시각 구성요소
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now).map((p) => [p.type, p.value])
  );
  const h = Number(parts.hour) % 24, m = Number(parts.minute), s = Number(parts.second);
  const msUntilMidnight = ((24 - h) * 3600 - m * 60 - s) * 1000;
  const reset = new Date(now.getTime() + msUntilMidnight);
  const kst = reset.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
  const day = reset.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
  return { at: reset.toISOString(), kst, day };
}
