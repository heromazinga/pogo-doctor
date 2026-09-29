// 4-D 앱 버전 비교. MIN_TRUSTED_APP_VERSION 이상(라벨행 값 채택 경로 폐지, 4-C.4)으로 기록된 스캔은 "신뢰 기록":
//   같은 종·CP·HP(또는 같은 종·개체값) 충돌 시 신뢰 기록이 이전(미신뢰) 기록을 superseded 로 대체한다.
export const MIN_TRUSTED_APP_VERSION = "0.1.38";

export function parseVersion(v) {
  const m = String(v || "").trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
export function versionGte(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return true;
}
export const isTrustedVersion = (v) => versionGte(v, MIN_TRUSTED_APP_VERSION);
