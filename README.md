# 꼬리별 반려동물 호텔 — 백엔드

가상의 반려동물 호텔 "꼬리별"의 숙박 예약 백엔드입니다.
보호자가 쓰는 **코어 웹**과 직원이 쓰는 **어드민 웹**이 이 백엔드 하나를 함께 씁니다.

- 코어 웹 저장소: `kkoribyeol-web`
- 어드민 저장소: `kkoribyeol-admin`
- 설계와 결정 이유: [설계.md](./설계.md)

> **무료 서버라 15분 쉬면 잠듭니다.** 처음 열 때 1분 가까이 걸릴 수 있어요. `/health`를 한 번 열어 깨운 뒤에 쓰세요.

## 기술

NestJS 12 · Prisma 7 · PostgreSQL (Render) · JWT · bcrypt

## 설정값 (환경 변수)

`.env` 파일이나 Render 설정값에 넣습니다. **저장소에는 올리지 않습니다.**

| 이름 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 주소. 끝에 `?schema=hw2`를 붙여 이 과제용 공간만 씁니다 |
| `JWT_SECRET` | 로그인 토큰 서명용 비밀 문자열 |
| `FRONTEND_ORIGIN` | 요청을 받아 줄 주소. 코어 웹과 어드민 주소를 쉼표로 이어 씁니다 |
| `PORT` | 서버 포트 (Render가 자동으로 넣어 줍니다) |
| `SEED_ADMIN_EMAIL` | 처음 관리자 계정의 이메일 |
| `SEED_ADMIN_PASSWORD` | 처음 관리자 계정의 비밀번호 |
| `SEED_GUARDIAN_PASSWORD` | 가상 보호자들의 비밀번호 |

## 실행

```bash
npm install
npx prisma migrate deploy   # 테이블과 제약 만들기
npm run seed                # 가상 데이터 채우기
npm run start:dev
```

## 주요 주소

| 메서드 | 주소 | 누가 |
| --- | --- | --- |
| GET | `/health` | 누구나 (DB 연결 상태) |
| POST | `/auth/register`, `/auth/login` | 보호자 |
| POST | `/auth/staff/login` | 직원 |
| POST | `/auth/staff/change-password` | 직원 |
| GET/POST/PATCH | `/pets`, `/pets/:id` | 보호자 (직원은 입실 때 수정) |
| GET | `/pets/expiring-vaccines` | 직원 |
| GET | `/guardians?keyword=` | 직원 |
| GET | `/reservations/availability?checkIn=&checkOut=` | 로그인한 사람 |
| GET/POST | `/reservations` | 보호자는 자기 것만, 직원은 전체 |
| POST | `/reservations/:id/cancel` | 보호자(자기 것)·직원 |
| POST | `/reservations/:id/check-in`, `/check-out` | 직원 |
| GET | `/reservations/today` | 직원 |
| GET/POST/PATCH | `/staff`, `/staff/:id` | 관리자만 |
| POST | `/staff/:id/reset-password` | 관리자만 |

## 규칙 자동 점검

규칙을 어기는 요청까지 한 번에 눌러 보고 결과를 보여 줍니다.

```bash
node -r dotenv/config scripts/check-rules.mjs                      # 로컬
node -r dotenv/config scripts/check-rules.mjs https://<배포 주소>   # 배포 서버
```

## 규칙을 어디서 막는가

**DB가 막는 것** — 한 줄이나 한 테이블만 보면 되는 규칙

- 이메일 중복, 방 번호 중복 (UNIQUE)
- 체크아웃 > 체크인, 서비스 횟수 ≥ 1 (CHECK)
- 한 예약에 같은 아이 두 번 (복합 기본 키)
- **같은 방 날짜 겹침 (EXCLUDE)** — 두 요청이 동시에 와도 뚫리지 않습니다

**백엔드가 막는 것** — 다른 테이블을 함께 보거나 세어 봐야 하는 규칙

- 한 예약에 2마리까지, 몸무게에 맞는 방, 접종 1년·생후 5개월
- 내 아이만 맡기기, 내 예약만 보기, 직원만 상태 변경, 관리자만 계정 관리

자세한 이유는 [설계.md](./설계.md)에 있습니다.
