#!/bin/bash
# 릴리스 서명 keystore 1회 생성 → GitHub Secrets 등록용 값 출력
# 사용: bash android/scripts/make-keystore.sh  (JDK keytool 필요. 로컬 PC 가 없으면 GitHub Codespaces 나 Actions 의 workflow_dispatch 에서 실행)
set -e
OUT=${1:-pogo-release.jks}
ALIAS=${ALIAS:-pogo}
PASS=${PASS:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)}
keytool -genkeypair -v -keystore "$OUT" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=pogo-doctor, OU=collector, O=pogo-doctor, C=KR"
echo
echo "GitHub → Settings → Secrets and variables → Actions 에 등록:"
echo "  ANDROID_KEYSTORE_BASE64 = (아래 한 줄)"
base64 -w0 "$OUT"; echo
echo "  ANDROID_KEYSTORE_PASSWORD = $PASS"
echo "  ANDROID_KEY_ALIAS = $ALIAS"
echo "  ANDROID_KEY_PASSWORD = $PASS"
echo
echo "keystore 파일($OUT)과 비밀번호는 안전한 곳에 보관하고 저장소에 커밋하지 마세요."
