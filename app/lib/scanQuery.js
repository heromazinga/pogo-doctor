// 4-D 활성 스캔 기록 전체 조회 (페이지네이션, 상한 3000)
//   실DB 결함: /api/scan·/api/cleanup·/api/verdict/stats 가 limit(300) 으로 활성 518건 중 300건만 써서 정리 도우미 population·예상 수·보호 판단이 틀렸다.
export const SCAN_FETCH_MAX = 3000;
export const SCAN_PAGE_SIZE = 1000;

// 반환: 활성(dismissed=false, superseded=false) 기록 전부, created_at 내림차순. { items, truncated }
export async function fetchActiveScanItems(sb, userId, { max = SCAN_FETCH_MAX, pageSize = SCAN_PAGE_SIZE, select = "*" } = {}) {
  const items = [];
  let from = 0, truncated = false;
  while (from < max) {
    const to = Math.min(from + pageSize, max) - 1;
    const { data, error } = await sb.from("scan_items").select(select).eq("user_id", userId).eq("dismissed", false).eq("superseded", false).order("created_at", { ascending: false }).range(from, to);
    if (error) throw new Error(error.message);
    const page = data || [];
    items.push(...page);
    if (page.length < to - from + 1) break;
    from = to + 1;
    if (from >= max) truncated = true;
  }
  return { items, truncated };
}
