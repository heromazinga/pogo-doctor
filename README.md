# 포고박사 (PoGo Doctor) ⚡

포켓몬GO AI 어드바이저 — 킵? 버려? 냅둬? AI가 판정해드립니다.

## 구조

- **포켓몬 데이터**: pogoapi.net에서 종족값, 기술 목록을 실시간으로 가져옴 (무료, 키 필요 없음)
- **AI 판정**: Google Gemini 2.0 Flash (무료 API)로 데이터 기반 분석
- **프레임워크**: Next.js 14 (App Router) + Vercel 배포

## 셋업 (로컬)

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local 파일을 열고 Gemini API 키 입력

# 3. 실행
npm run dev
```

## Gemini API 키 발급 (무료)

1. https://aistudio.google.com/apikey 접속
2. Google 계정으로 로그인
3. "Create API Key" 클릭
4. 생성된 키를 `.env.local`의 `GEMINI_API_KEY`에 입력

> 무료 티어: 분당 15회, 일일 1500회 요청 가능 (개인 사용 충분)

## Vercel 배포

1. GitHub에 이 프로젝트 푸시
2. https://vercel.com 에서 "Import Project" → GitHub 저장소 선택
3. Environment Variables에 `GEMINI_API_KEY` 추가
4. Deploy!

## 참고

- 현재 포켓몬 이름은 **영어**로 검색됩니다 (API 데이터가 영어)
- 향후 한국어 이름 매핑 추가 예정
- 기술 이름도 영어로 표시됩니다 (pogoapi.net 기준)
- AI 판정은 한국어로 응답합니다

