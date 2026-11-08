# AIMers

대학생이 정해진 기간마다 경험을 기록하면, AI가 꼬리질문으로 내용을 구체화하고 정리해 주는 모바일 웹 서비스입니다. 쌓인 기록으로 면접 예상 질문, 자소서 문항 맞춤 경험 검색, 학기별 성장 인사이트를 제공합니다.

## 실행

Node.js 24 이상이 필요합니다. Node.js의 기본 SQLite 모듈을 사용합니다.

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

### Google 로그인

Google Cloud에서 웹 애플리케이션 유형의 OAuth 클라이언트를 사용합니다. 승인된 리디렉션 URI에 `http://localhost:3000/auth/google/callback`을 등록합니다. 동의 화면이 테스트 상태라면 로그인할 계정을 테스트 사용자에 추가합니다.

다운로드한 `client_secret*.json` 파일을 프로젝트 루트에 두면 서버가 읽습니다. 이 파일과 `.env`는 Git에서 제외됩니다. 파일을 따로 전달받았다면 클라이언트 시크릿을 다시 입력할 필요가 없습니다. 여러 자격 증명 파일이 있다면 `.env`의 `GOOGLE_CLIENT_SECRET_FILE`로 파일 하나를 지정합니다. 프로젝트 밖의 절대 경로도 사용할 수 있습니다.

JSON 파일 대신 아래 환경변수로 설정할 수도 있습니다. `.env.example`을 참고하세요.

```dotenv
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

외부 주소나 ngrok을 사용할 때는 `APP_URL`을 해당 HTTPS 주소로 바꾸고, Google Cloud에도 같은 주소의 `/auth/google/callback`을 등록한 뒤 서버를 다시 시작합니다. 로그인은 설정한 `APP_URL`에서 시작해야 합니다. LAN의 HTTP 주소는 로그인에 사용하지 않습니다.

개인 프로필에서 Google 로그인과 로그아웃을 할 수 있습니다. 서버는 state, PKCE, nonce와 Google ID 토큰을 검증하고 HttpOnly 세션 쿠키를 발급합니다. Google API 액세스 토큰과 클라이언트 시크릿은 브라우저에 전달하지 않습니다.

세션은 SQLite에 7일간 보관하며 서버를 재시작해도 유지됩니다. 세션 토큰은 DB에 SHA-256 해시로 저장합니다. 비로그인 사용자는 시연 화면을 조회할 수 있으며, 기록 변경과 AI API, 그룹 기능은 로그인이 필요합니다.

### 사용자 식별과 DB 저장

Google에서 검증한 ID 토큰의 `sub`를 `users.google_sub`에 고유값으로 저장합니다. 서비스 내부 사용자 ID인 `users.id`는 별도 UUID입니다. 이메일과 이름이 변경되어도 같은 `sub`라면 기존 사용자와 연결하며, 이메일이 같더라도 `sub`가 다르면 별도 사용자로 취급합니다.

기본 DB 경로는 `data/aimers.sqlite`입니다. `.env`의 `DATABASE_PATH`로 변경할 수 있습니다. DB 파일과 WAL 파일은 Git에서 제외합니다. 서버를 다른 환경으로 옮길 때는 DB를 보존할 영구 디스크를 연결해야 합니다. Google 클라이언트 시크릿과 AI API 키는 서버 환경변수 또는 자격 증명 파일에 보관합니다.

저장 테이블은 다음과 같습니다.

| 테이블 | 저장 내용 |
| --- | --- |
| `users` | 내부 ID, Google sub, 이메일, Google 이름, 가입 시각, 마지막 로그인 |
| `profiles` | 프로필 사진과 이름, 소개, 공개 여부, 작성 주기, 알림과 화면 설정, 저장 버전 |
| `categories`, `entries` | 카테고리, 원문, 꼬리질문과 답변, 요약, 날짜, 태그 |
| `groups`, `memberships` | 그룹, 초대 코드, 실제 사용자 멤버십 |
| `pokes` | 발신자와 수신자, 기록 기간별 콕 찌르기, 앱 내 알림 읽음 상태 |
| `sessions`, `oauth_flows` | 로그인 세션과 만료 시각, 진행 중인 OAuth 검증 정보 |
| `ai_runs` | AI 요청 종류, 입력, 결과, 생성 시각 |

로그인 후 서버에서 기록을 읽고 변경할 때마다 저장합니다. 여러 기기에서 동시에 수정하면 저장 버전을 비교해 충돌을 알립니다. 실패한 변경 내용은 열린 화면에 유지하며, 재시도하거나 JSON으로 내보낼 수 있습니다. 새로고침하거나 창을 닫기 전에는 저장 상태를 확인해야 합니다. 서버 내용은 페이지를 다시 열거나 브라우저 창으로 돌아올 때 불러옵니다.

이전 localStorage 기록이 남아 있으면 개인 프로필에서 가져오기 버튼을 제공합니다. 해당 Google 계정의 이전 기록을 우선하고, 없으면 기존 비로그인 기록을 제안합니다. 사용자가 확인하면 개인 기록과 설정을 교체하며, 현재 그룹과 공개 설정은 유지합니다. 시연용 그룹과 가상 멤버는 이관하지 않고, 원본 localStorage는 삭제하지 않습니다.

그룹은 초대 코드로 실제 계정이 참여합니다. 새 계정의 기록은 기본 비공개이며, 공개로 설정하면 같은 그룹의 멤버에게 기록을 제공합니다. 비공개 기록의 본문은 다른 멤버의 API 응답에서 제외합니다. 그룹에서 나가면 공유 접근도 종료됩니다. 콕 찌르기는 DB에 저장하고 그룹 탭의 앱 내 알림으로 전달합니다.

DB를 백업하려면 서버를 정상 종료한 뒤 `data` 폴더를 복사합니다. 실행 중인 SQLite 파일 하나만 복사하면 WAL에 있는 최신 변경이 빠질 수 있습니다.

구현 기준은 [Google 웹 서버 OAuth 문서](https://developers.google.com/identity/protocols/oauth2/web-server)와 [OpenID Connect 문서](https://developers.google.com/identity/openid-connect/openid-connect)입니다.

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
| `auth.js` | Google OAuth 검증과 DB 세션 |
| `db.js` | SQLite 테이블, 사용자별 저장과 그룹 권한 검증 |
| `ai.js` | AI 기능별 프롬프트, 응답 형식, 입력 검증, 시연 모드 답변 |
| `public/app.js` | 화면과 동작 |
| `public/logic.js` | 기록 기간, 연속 기록, 학기 계산 |
| `public/styles.css` | 스타일 |
| `test.js` | 자체 점검 테스트 |
| `auth.test.js`, `db.test.js`, `app.test.js` | 인증, DB와 API, DOM 기반 저장 동작 테스트 |

## 현재 한계 (해커톤 시연 버전)

- 마감 알림은 앱을 열었을 때만 표시됩니다.
- 콕 찌르기는 앱 내 알림이며 이메일이나 모바일 푸시로 전송하지 않습니다.
- AI 활동은 DB에 모두 저장하며 화면에서는 최근 30개를 조회합니다.
- UI 검사는 DOM 기반 자동 테스트입니다. 실제 Google 계정으로 로그인하는 최종 검증은 별도로 필요합니다.
