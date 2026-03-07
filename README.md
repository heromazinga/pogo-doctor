# 포고박사 (PoGo Doctor) ⚡

포켓몬GO AI 어드바이저 — 킵? 버려? 냅둬? AI가 판정해드립니다.

## v0.4 변경사항

- **속도 개선**: Gemini 2.0 Flash → **Gemini 3.1 Flash Lite** 업그레이드 (2.5배 빠른 응답) + 모델 폴백 체인
- **기술 한글화**: PokeAPI에서 한국어 기술명 동적 로딩 (sessionStorage 캐시)
- **상성/카운터 분석**: AI 판정에 상성 분석 + 카운터 포켓몬 추천 포함
- **보유목록**: 분석 결과에서 "킵" 체크 시 로컬 저장, 도감번호순 정렬

## 구조

* **포켓몬 데이터**: pogoapi.net에서 종족값, 기술 목록을 실시간으로 가져옴 (무료, 키 필요 없음)
* **한국어 이름**: pokeapi.co에서 한국어 포켓몬 이름 매핑
* **AI 판정**: Google Gemini 3.1 Flash Lite (무료 API, 폴백: 3 Flash → 2.0 Flash)로 데이터 기반 분석
* **프레임워크**: Next.js 14 (App Router) + Vercel 배포

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

> 무료 티어: Gemini 3.1 Flash Lite는 분당 30회, 일일 1500회 요청 가능

## Vercel 배포

1. GitHub에 이 프로젝트 푸시
2. https://vercel.com 에서 "Import Project" → GitHub 저장소 선택
3. Environment Variables에 `GEMINI_API_KEY` 추가
4. Deploy!

## 기능

- ✅ 포켓몬 이름 한글 자동완성 (도감번호/영어/한글 검색)
- ✅ 기술 한글화 (PokeAPI 동적 로딩 + sessionStorage 캐시, 영어 병기)
- ✅ IV 슬라이더 + CP 입력
- ✅ 이로치/그림자 토글
- ✅ AI 분석: 종합판정, PvP/PvE 평가, 상성분석, 카운터 추천, 기술평가
- ✅ 보유목록 (로컬스토리지, 도감번호순)
