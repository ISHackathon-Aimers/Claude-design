# AIMers

대학생이 정해진 기간마다 경험을 기록하면, AI가 꼬리질문으로 내용을 구체화하고 정리해 주는 모바일 웹 서비스입니다. 쌓인 기록으로 면접 예상 질문, 자소서 문항 맞춤 경험 검색, 학기별 성장 인사이트를 제공합니다.

## 실행

Node.js 24가 필요합니다. Vercel에서도 같은 버전을 사용합니다.

```bash
npm ci
npm start
```

`npm start`는 Supabase 브라우저 SDK를 먼저 번들링합니다. 정적 파일만 별도로 제공하려면 먼저 `npm run build`를 실행하세요.

브라우저에서 `http://localhost:3000`을 엽니다. 같은 와이파이의 휴대폰에서 열 주소는 실행할 때 터미널에 표시됩니다.

### AI 연결

AI는 DeepSeek API(`deepseek-flash` 모델)를 사용합니다. 프로젝트 폴더에 `.env` 파일을 만들고 키를 넣으면 `npm start`가 자동으로 읽습니다.

```bash
DEEPSEEK_API_KEY=발급받은_키
```

키가 없으면 **시연 모드**로 실행되어 미리 준비한 답변을 보여 줍니다. `.env`는 `.gitignore`에 들어 있어 저장소에 올라가지 않습니다. 키는 서버에서만 사용하며, 코드에 직접 쓰지 마세요.

### 테스트

```bash
npm test
```

## 화면 구성

| 탭 | 기능 |
| --- | --- |
| 내 대시보드 | 기간별 경험 기록(작성 → AI 꼬리질문 → AI 정리), 시간순·카테고리순 보기, 원본 보기, 기록 통계 |
| 부가 서비스 | 면접 예상 질문과 답변 평가, 자소서 문항 관련 경험 검색, 성장 인사이트 |
| 내 그룹 | 그룹별 기간 내 작성 여부, 미작성자 콕 찌르기, 친구 기록 보기(공개 설정 따름) |
| 개인 프로필 | 프로필 사진, 공개 설정, 작성 기간·시작 날짜, 연속 기록과 불타는 프로필, 글꼴·글자 크기 |

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `server.js` | 정적 파일 제공과 `/api/ai` 엔드포인트 |
| `ai.js` | AI 기능별 프롬프트, 응답 형식, 입력 검증, 시연 모드 답변 |
| `public/app.js` | 화면과 동작 |
| `public/logic.js` | 기록 기간, 연속 기록, 학기 계산 |
| `public/styles.css` | 스타일 |
| `test.js` | 자체 점검 테스트 |

## 현재 한계 (해커톤 시연 버전)

- 비로그인 시연 데이터는 브라우저에 저장됩니다. 로그인한 사용자의 기록과 설정은 Supabase DB에 저장됩니다.
- 그룹 친구는 시연용 가상 사용자이며, 초대 코드와 콕 찌르기는 실제로 전송되지 않습니다.
- 마감 알림은 앱을 열었을 때만 표시됩니다.

## Vercel과 Supabase 구성

한 저장소에서 화면과 서버 API를 관리합니다. Vercel은 `public/`의 정적 파일과 `api/index.js`의 Node.js 함수를 배포합니다. Supabase는 Google 로그인과 PostgreSQL 데이터 저장을 담당합니다.

로그인은 Supabase Auth의 PKCE 흐름을 사용합니다. 기존 Google OAuth 서버와 메모리 세션은 사용하지 않습니다. Google 클라이언트 시크릿은 Supabase 대시보드에만 등록합니다. 기존 `client_secret*.json`은 더 이상 읽지 않으며 Git에서도 제외됩니다.

현재 DB는 사용자마다 `user_states` 행 하나에 프로필, 경험 기록, 카테고리, 설정을 JSON으로 보관합니다. 시연 버전의 데이터 구조를 유지하기 위한 선택입니다. 실제 그룹 공유와 다른 사용자의 기록 검색을 추가할 때는 기록과 그룹 멤버십을 별도 테이블로 분리해야 합니다.

DB 읽기에는 사용자별 RLS 정책을 적용합니다. 쓰기는 로그인 사용자를 확인하는 `save_user_state` 함수로만 허용합니다. 저장 버전이 달라지면 덮어쓰기를 차단합니다. 브라우저는 실패한 저장을 임시 보관하며 재시도, JSON 백업, 최신 기록 불러오기를 제공합니다. 화면 상단의 저장 상태를 확인하세요. 최신 기록을 불러오면 미저장 변경을 버리므로 필요한 내용은 먼저 백업하세요.

기존 로컬 시연 기록과 이전 Google 로그인 계정의 로컬 기록은 그대로 남지만 자동으로 DB에 가져오지 않습니다. 새 Supabase 계정은 빈 기록으로 시작합니다.

## Supabase 준비

1. Supabase 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/migrations/202611080001_user_states.sql`을 한 번 실행합니다. Supabase CLI를 이미 사용하는 프로젝트라면 같은 마이그레이션을 배포합니다.
3. Authentication의 Google 제공자를 활성화하고 Google OAuth Web 클라이언트 ID와 시크릿을 등록합니다.
4. Google Cloud의 승인된 리디렉션 URI에 Supabase가 표시하는 콜백 URL을 등록합니다. 일반적인 형태는 `https://PROJECT_REF.supabase.co/auth/v1/callback`입니다. 기존 앱의 `/auth/google/callback` 주소는 사용하지 않습니다.
5. Supabase Authentication의 URL Configuration에서 Site URL을 실제 배포 주소로 설정하고 Redirect URLs에 `http://localhost:3000/`과 사용할 배포 주소의 루트 URL을 등록합니다. Preview 배포를 테스트하려면 그 주소도 허용해야 합니다.
6. Google OAuth 앱이 테스트 상태라면 시연 참가자를 테스트 사용자로 등록합니다.

공식 설정 안내: [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## 환경 변수

`.env.example`을 참고해 로컬 `.env`와 Vercel 프로젝트 환경 변수를 설정합니다. Supabase 환경 변수가 모두 없으면 비로그인 시연으로 실행됩니다. 둘 중 하나만 설정하면 설정 오류로 처리합니다.

- `SUPABASE_URL`: 프로젝트 URL.
- `SUPABASE_PUBLISHABLE_KEY`: 브라우저에서 사용 가능한 publishable 키. 이전 프로젝트는 `SUPABASE_ANON_KEY`로 anon 키를 지정할 수도 있습니다.
- `DEEPSEEK_API_KEY`: 실제 AI를 사용할 때만 등록하는 서버 전용 키.
- `AIMERS_DEMO`: `1`이면 준비된 AI 답변을 사용합니다. 실제 AI를 사용하려면 삭제하거나 `0`으로 설정합니다.

Supabase secret 키와 service_role 키는 사용하지 않습니다. `/api/config`는 공개 Supabase 설정만 반환합니다. 실제 AI 호출은 Supabase가 검증한 액세스 토큰이 있어야 허용됩니다. 준비된 시연 답변은 로그인 없이 사용할 수 있습니다.

## Vercel 배포

1. GitHub에 작업 브랜치를 올리고 Vercel에서 저장소를 가져옵니다.
2. Framework Preset은 Other를 선택합니다. Root Directory는 이 프로젝트 루트입니다.
3. `vercel.json`이 지정한 Build Command `npm run build`와 Output Directory `public`을 사용합니다. Node.js 버전은 `package.json`의 24.x를 따릅니다.
4. 위 환경 변수를 사용할 배포 환경에 등록하고 배포합니다.
5. 배포 주소를 Supabase 허용 URL에 등록합니다.
6. Google 로그인, 기록 작성, AI 정리, 저장 완료 표시, 로그아웃, 다른 기기에서 재조회까지 확인합니다.

인증 설정 변경이나 환경 변수 변경 후에는 새 배포가 필요할 수 있습니다. 실제 AI를 사용하면 서버 함수가 최대 90초 실행되도록 구성되어 있으므로 배포 환경의 함수 실행 설정도 확인하세요.

공식 설정 안내: [Vercel 구성](https://vercel.com/docs/project-configuration/vercel-json).

## 검증 범위

`npm test`는 기존 기록 계산과 AI 시연 API, 공개 설정의 비밀 키 차단, 토큰 검증, 저장 재시도와 충돌 처리를 점검합니다. DB 테스트는 PGlite의 PostgreSQL 엔진에 실제 마이그레이션을 적용해 사용자 간 접근 차단과 저장 버전 검사를 확인합니다. 실제 Supabase 프로젝트의 Google 로그인과 Vercel 배포 확인은 프로젝트 설정을 완료한 뒤 별도로 수행해야 합니다.
