// 4-D 활성 스캔 기록 전체 조회(페이지네이션) + 앱 버전 비교
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchActiveScanItems } from "../app/lib/scanQuery.js";
import { parseVersion, versionGte, isTrustedVersion, MIN_TRUSTED_APP_VERSION } from "../app/lib/appVersion.js";

// PostgREST 흉내: range(from,to) 로 슬라이스, 필터·정렬은 무시(사전 정렬된 배열)
function mockSb(rows) {
  const calls = [];
  const q = { _from: 0, _to: 0 };
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    range: async (from, to) => { calls.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; },
  };
  return { from: () => chain, calls };
}

test("fetchActiveScanItems: 300건 넘는 활성 기록을 페이지로 전부 읽는다 (실DB 518건 → limit 300 결함)", async () => {
  const rows = Array.from({ length: 518 }, (_, i) => ({ id: `r${i}` }));
  const sb = mockSb(rows);
  const { items, truncated } = await fetchActiveScanItems(sb, "u", { pageSize: 200 });
  assert.equal(items.length, 518); assert.equal(truncated, false);
  assert.deepEqual(sb.calls, [[0, 199], [200, 399], [400, 599]]);
});

test("fetchActiveScanItems: 상한 3000 에서 멈추고 truncated=true, 빈 결과는 0건", async () => {
  const rows = Array.from({ length: 3500 }, (_, i) => ({ id: `r${i}` }));
  const r = await fetchActiveScanItems(mockSb(rows), "u");
  assert.equal(r.items.length, 3000); assert.equal(r.truncated, true);
  const e = await fetchActiveScanItems(mockSb([]), "u");
  assert.equal(e.items.length, 0); assert.equal(e.truncated, false);
  const exact = await fetchActiveScanItems(mockSb(Array.from({ length: 1000 }, (_, i) => ({ id: i }))), "u");
  assert.equal(exact.items.length, 1000); assert.equal(exact.truncated, false);
});

test("fetchActiveScanItems: 오류는 throw", async () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, range: async () => ({ data: null, error: { message: "boom" } }) };
  const sb = { from: () => chain };
  await assert.rejects(() => fetchActiveScanItems(sb, "u"), /boom/);
});

test("앱 버전 비교: 0.1.38 이상이 신뢰 기록, 없음·형식 오류는 미신뢰", () => {
  assert.deepEqual(parseVersion("0.1.38"), [0, 1, 38]); assert.deepEqual(parseVersion("v1.2"), [1, 2, 0]); assert.equal(parseVersion("abc"), null);
  assert.equal(MIN_TRUSTED_APP_VERSION, "0.1.38");
  assert.ok(versionGte("0.1.38", "0.1.38") && versionGte("0.1.40", "0.1.38") && versionGte("0.2.0", "0.1.38") && versionGte("1.0.0", "0.1.38"));
  assert.ok(!versionGte("0.1.37", "0.1.38") && !versionGte("0.1.30", "0.1.38"));
  assert.ok(isTrustedVersion("0.1.38") && !isTrustedVersion("0.1.30") && !isTrustedVersion(null) && !isTrustedVersion(""));
});
