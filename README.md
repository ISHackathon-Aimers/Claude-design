# AIMers

대학생이 정해진 기간마다 경험을 기록하면, AI가 꼬리질문으로 내용을 구체화하고 정리해 주는 모바일 웹 서비스입니다. 쌓인 기록으로 면접 예상 질문, 자소서 문항 맞춤 경험 검색, 학기별 성장 인사이트를 제공합니다.

## 실행

Node.js 24가 필요합니다. 배포 서버는 Supabase를 사용합니다.

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다. 외부 기기에서 로그인하려면 HTTPS 주소를 사용하고 아래 Google 로그인 설정에 해당 주소를 등록합니다.

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

### Vercel과 Supabase 서버 구성

화면과 기능은 원격 main을 기준으로 유지합니다. Vercel이 정적 파일과 서버 API를 실행하고, Supabase가 Google 로그인과 영구 DB 저장을 담당합니다. 프론트와 서버를 별도 저장소로 나누지 않습니다.

Node.js 24를 사용합니다. `npm start`와 `npm test`는 실행 전에 Supabase 브라우저 SDK를 빌드합니다. Vercel의 Build Command는 `npm run build`, Output Directory는 `public`, Framework Preset은 Other입니다. `vercel.json`이 API 경로와 실행 시간을 설정합니다.

### Google 로그인 설정

Supabase Authentication의 Google 제공자를 활성화하고 Google OAuth Web 클라이언트 ID와 시크릿을 등록합니다. Google Cloud의 승인된 리디렉션 URI에는 Supabase 제공자 화면의 콜백 URL을 등록합니다. 일반적인 주소는 `https://PROJECT_REF.supabase.co/auth/v1/callback`입니다.

Supabase Authentication의 URL Configuration에서 Site URL을 배포 주소로 설정하고 Redirect URLs에 실제 접속할 사이트의 루트 URL을 등록합니다. 로컬 개발에는 `http://localhost:3000/`을 추가합니다. 브라우저는 로그인을 시작한 사이트의 루트로 돌아옵니다.

Google OAuth가 Internal이면 해당 Google 조직의 계정만 로그인할 수 있습니다. Google 클라이언트 시크릿은 Supabase에 등록하며 Vercel이나 브라우저에 넣지 않습니다. 기존 `client_secret*.json`과 직접 Google OAuth 세션은 이 배포 브랜치에서 사용하지 않습니다.

### 환경 변수

로컬 `.env`와 Vercel의 사용할 배포 환경에 같은 변수 이름으로 등록합니다. 환경 변수 변경 후에는 Vercel을 다시 배포합니다.

| 변수 | Vercel 타입 | 내용 |
| --- | --- | --- |
| `SUPABASE_URL` | Config | 전체 Supabase 프로젝트 URL |
| `SUPABASE_PUBLISHABLE_KEY` | Config | 브라우저 공개용 publishable 키 |
| `DEEPSEEK_API_KEY` | Secret | 실제 AI를 사용할 때 등록하는 서버 전용 키 |
| `AIMERS_DEMO` | Config | `1`은 준비된 AI 답변, `0`은 실제 AI 사용 |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | 푸시 전송 전용 서버 관리자 키 |
| `VAPID_PUBLIC_KEY` | Config | 웹 푸시 공개 키 |
| `VAPID_PRIVATE_KEY` | Secret | 웹 푸시 비공개 키 |
| `VAPID_SUBJECT` | Config | 운영자 연락처. 예: `mailto:admin@example.com` |
| `CRON_SECRET` | Secret | 예약 API 인증에 쓰는 충분히 긴 임의 문자열 |

이전 anon 키는 `SUPABASE_ANON_KEY`로도 사용할 수 있습니다. 로그인과 개인 기록 처리는 공개 키와 사용자 토큰을 사용합니다. `SUPABASE_SERVICE_ROLE_KEY`는 서버의 푸시 전송 처리에만 사용하며 브라우저에 반환하지 않습니다. 비로그인 시연 화면은 조회할 수 있지만 기록 변경, AI 기능, 그룹 기능에는 로그인이 필요합니다. 서버는 매 요청의 Supabase 액세스 토큰을 검증하고 클라이언트 계정 ID와 비교합니다.

### DB 마이그레이션

새 Supabase 프로젝트에서는 SQL Editor에서 아래 파일을 순서대로 한 번씩 실행합니다. 이미 적용한 파일은 다시 실행하지 않습니다.

1. `supabase/migrations/202611080001_user_states.sql`
2. `supabase/migrations/202611080002_main_features.sql`
3. `supabase/migrations/202611080003_poke_cooldown.sql`
4. `supabase/migrations/202611080004_web_push.sql`

기존 서버에는 아직 적용하지 않은 파일만 번호 순서대로 실행한 뒤 새 코드를 배포합니다. 기존 `user_states`와 개인 기록을 삭제하거나 교체하지 않습니다. 각 SQL 파일은 한 트랜잭션이므로 실패하면 오류를 해결한 뒤 다시 실행합니다.

### 웹 푸시 설정

1. `npx web-push generate-vapid-keys --json`으로 키 한 쌍을 생성합니다. 공개 키와 비공개 키를 위 환경 변수에 각각 등록합니다. 키를 바꾸면 기기에서 알림을 다시 켜야 합니다.
2. Supabase 프로젝트의 서버 전용 `service_role` 키를 `SUPABASE_SERVICE_ROLE_KEY`에 등록하고, 운영자 연락처와 예약 API 인증 문자열을 설정합니다. 이 값들은 저장소에 커밋하지 않습니다.
3. 세 번째와 네 번째 마이그레이션을 적용하고 Vercel에 배포합니다. `vercel.json`은 매일 UTC 00시, 한국 시간 오전 9시에 `/api/cron/push`를 호출합니다. Vercel은 `CRON_SECRET`을 Bearer 인증으로 보냅니다. Hobby 요금제에서는 지정된 시간부터 1시간 안에 실행될 수 있습니다.
4. 아이폰은 iOS 16.4 이상에서 Safari로 열고 공유 메뉴의 "홈 화면에 추가"를 선택합니다. 홈 화면 아이콘으로 실행하고 로그인한 뒤 프로필의 "이 기기에서 알림 켜기"를 누르고 권한을 허용합니다. "테스트 알림"으로 확인합니다.

알림을 켜면 매일 기록 알림도 활성화합니다. 매일 알림을 꺼도 콕 찌르기 알림은 유지됩니다. "이 기기에서 알림 끄기"와 로그아웃은 해당 기기의 구독을 해제합니다. 다른 기기의 구독은 유지됩니다. 콕 찌르기는 같은 그룹의 같은 사람에게 마지막 전송 후 5분이 지나야 다시 보낼 수 있습니다.

알림 소리는 운영체제 기본 설정을 따릅니다. 아이폰의 설정에서 알림, AIMers, 알림 허용과 사운드를 켜야 합니다. 무음 모드나 집중 모드에서는 소리가 나지 않을 수 있으며 웹앱이 이를 강제로 변경하거나 사용자 지정 알림음을 지정할 수 없습니다.

전송 실패는 대기열에 남기며 다음 예약 호출이나 같은 발신자의 콕 찌르기 요청 때 재시도합니다. 최대 5회, 생성 후 24시간 이내 작업만 처리합니다. 각 호출은 최대 100개 작업을 처리하므로 대규모 운영에는 예약 호출 주기와 처리량 조정이 필요합니다. 만료된 구독은 자동으로 삭제하고 전송 이력은 7일 뒤 정리합니다. 전송 결과가 불확실한 네트워크 실패에서는 재시도로 알림이 중복될 수 있습니다.

운영 서버에서는 Vercel Cron이 예약 호출을 담당합니다. 로컬 `npm start`에는 예약 실행기가 없으므로 검증용 스케줄러에서 같은 인증 헤더로 예약 API를 호출해야 합니다.

공식 안내: [Apple 웹 푸시](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Vercel Cron 보안](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Vercel 예약 실행 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing).

| 저장소 | 내용 |
| --- | --- |
| Supabase Auth | 사용자 UUID, Google 연결 정보, 로그인 세션 |
| `user_states` | 프로필, 사진, 개인 기록, 카테고리, 설정, 저장 버전 |
| `app_groups`, `app_memberships` | 그룹, 초대 코드, 실제 사용자 멤버십 |
| `app_pokes` | 5분 간격의 콕 찌르기와 수신자의 앱 내 알림 읽음 상태 |
| `app_push_subscriptions`, `app_push_jobs` | 기기별 웹 푸시 구독과 전송 대기열 |
| `app_ai_runs` | AI 입력과 결과, 최근 활동 조회 |

개인 기록은 사용자별 RLS로 보호합니다. 그룹과 AI 이력 테이블은 클라이언트의 직접 접근을 막고, 로그인 사용자와 멤버십을 검사하는 DB 함수를 통해서만 처리합니다. 비공개 기록의 원문은 그룹 멤버에게도 반환하지 않습니다. 그룹 탈퇴 시 공유 접근을 종료하고 소유자를 다음 멤버로 넘기거나 빈 그룹을 삭제합니다.

화면과 API는 main의 저장 버전 비교, 실패 시 열린 화면에 변경 내용 유지, 재시도, JSON 내보내기, 명시적인 이전 브라우저 기록 가져오기를 유지합니다. 다른 기기나 계정에서 같은 내용을 동시에 수정하면 덮어쓰기를 차단합니다. 저장 중이거나 실패한 상태에서는 창을 닫기 전에 저장 상태를 확인해야 합니다. 현재 계정 문서의 저장 크기는 최대 약 3 MB입니다.

SQLite 데이터는 자동으로 Supabase에 이관하지 않습니다. main의 `db.js`는 기존 동작 검증용으로 유지하며 배포 서버는 `supabase-db.js`를 사용합니다. 기존 main의 SQLite 사용자 UUID와 Supabase 사용자 UUID는 다르므로 DB 파일을 그대로 복사해서 사용할 수 없습니다.

### 배포 후 확인

Google 로그인, 기존 기록 조회, 새 기록 저장, 다른 기기 재조회, 다른 계정과의 데이터 분리, 그룹 생성과 초대 코드 참여, 공개 설정에 따른 기록 공유, 콕 찌르기 알림과 읽음 처리, AI 실행 이력을 확인합니다. `npm test`는 main의 UI와 API 회귀 테스트 및 PostgreSQL 마이그레이션과 Supabase 저장 어댑터 검증을 포함합니다. 실제 Google OAuth와 배포 환경 검증은 별도로 필요합니다.

공식 설정 안내: [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Vercel 구성](https://vercel.com/docs/project-configuration/vercel-json).

## 화면 구성

| 탭 | 기능 |
| --- | --- |
| 내 대시보드 | 이번 기록 기간(날짜·요일 선택해 기록), 기록 통계, 나의 기록·AIMers+·내 그룹 요약 |
| 내 기록 | 전체 기록, 시간순·카테고리순 보기, 카테고리 필터, 원본 보기 |
| 내 그룹 | 멤버별 각자의 기록 기간과 마감, 미작성 멤버 콕 찌르기, 친구 기록 보기(공개 설정 따름) |
| AIMers+ | 면접 예상 질문과 답변 평가, 자소서 문항 관련 경험 검색(기록 근거), 성장 인사이트(역량 육각형) |

개인 프로필은 오른쪽 위 프로필 사진으로 들어갑니다. 프로필 사진, 로그인, 공개 설정, 작성 기간·시작 날짜, 연속 기록과 불타는 프로필, 카테고리 관리, 화면 모드(시스템·라이트·다크), 글자 크기를 설정합니다.

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `server.js` | 정적 파일 제공과 `/api/ai` 엔드포인트 |
| `auth.js` | Supabase 액세스 토큰 검증 |
| `supabase-db.js` | Supabase 저장과 그룹 API 어댑터 |
| `ai.js` | AI 기능별 프롬프트, 응답 형식, 입력 검증, 시연 모드 답변 |
| `public/app.js` | 화면과 동작 |
| `public/logic.js` | 기록 기간, 연속 기록, 학기 계산 |
| `public/styles.css` | 스타일 |
| `test.js` | 자체 점검 테스트 |
| `auth.test.js`, `db.test.js`, `app.test.js` | 인증, DB와 API, DOM 기반 저장 동작 테스트 |

## 현재 한계 (해커톤 시연 버전)

- 마감 알림은 앱을 열었을 때만 표시됩니다.
- 콕 찌르기는 앱 내 알림과 웹 푸시로 전달합니다. 웹 푸시는 아래 서버 설정과 기기별 권한 허용이 필요합니다.
- AI 활동은 DB에 모두 저장하며 화면에서는 최근 30개를 조회합니다.
- UI 검사는 DOM 기반 자동 테스트입니다. 실제 Google 계정으로 로그인하는 최종 검증은 별도로 필요합니다.
