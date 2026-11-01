// 요구사항을 하나씩 자동으로 눌러 본다.
//   로컬:  node scripts/check-rules.mjs
//   배포:  node scripts/check-rules.mjs https://...onrender.com
// 규칙을 어기는 요청도 일부러 보내서, 백엔드가 쉬운 말로 거절하는지 확인한다.

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');
const GUARDIAN = { email: 'kim@example.test', password: process.env.SEED_GUARDIAN_PASSWORD ?? 'kkori1234' };
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@kkoribyeol.test', password: process.env.SEED_ADMIN_PASSWORD };

let passed = 0;
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, data };
}

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function rejected(label, res, expectStatus = 400) {
  const message = res.data?.message ?? '';
  check(`${label} → ${res.status} "${message}"`, res.status === expectStatus, JSON.stringify(res.data));
}

const day = (n) => {
  const base = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
};

async function main() {
  console.log(`\n대상: ${BASE}\n`);
  if (!ADMIN.password) {
    console.log('SEED_ADMIN_PASSWORD 가 없습니다. backend/.env 를 읽도록 실행해 주세요.');
    process.exitCode = 1;
    return;
  }

  console.log('[1] 서버와 DB');
  const health = await call('GET', '/health');
  check(`/health → ${health.data?.db} (${health.data?.tookMs}ms, 스키마 ${health.data?.schema})`, health.data?.db === 'connected');

  console.log('\n[2] 로그인하지 않으면 못 쓴다');
  rejected('예약 목록을 토큰 없이', await call('GET', '/reservations'), 401);
  rejected('직원 목록을 토큰 없이', await call('GET', '/staff'), 401);

  console.log('\n[3] 회원가입과 로그인');
  const newEmail = `test${Date.now()}@example.test`;
  const signup = await call('POST', '/auth/register', {
    body: { email: newEmail, password: 'test1234', name: '테스트', phone: '010-0000-0000', emergencyPhone: '010-0000-1111' },
  });
  check('새 이메일로 회원가입', signup.status === 201 && !!signup.data?.token);
  rejected('같은 이메일로 또 가입', await call('POST', '/auth/register', {
    body: { email: newEmail, password: 'test1234', name: '테스트', phone: '010-0000-0000', emergencyPhone: '010-0000-1111' },
  }));
  rejected('짧은 비밀번호로 가입', await call('POST', '/auth/register', {
    body: { email: `x${Date.now()}@example.test`, password: '123', name: 'ㅇ', phone: '1', emergencyPhone: '2' },
  }));
  rejected('틀린 비밀번호로 로그인', await call('POST', '/auth/login', { body: { email: GUARDIAN.email, password: 'wrong-password' } }), 401);

  const login = await call('POST', '/auth/login', { body: GUARDIAN });
  check('보호자 로그인', login.status === 201 && !!login.data?.token);
  const guardianToken = login.data?.token;

  const staffLogin = await call('POST', '/auth/staff/login', { body: ADMIN });
  check('관리자 로그인', staffLogin.status === 201 && !!staffLogin.data?.token);
  const adminToken = staffLogin.data?.token;

  console.log('\n[4] 고객과 직원의 경계');
  rejected('보호자가 직원 목록 보기', await call('GET', '/staff', { token: guardianToken }), 403);
  rejected('보호자가 오늘 현황 보기', await call('GET', '/reservations/today', { token: guardianToken }), 403);
  const today = await call('GET', '/reservations/today', { token: adminToken });
  check(`직원은 오늘 현황을 본다 (입실 ${today.data?.arrivals?.length ?? '?'}건, 퇴실 ${today.data?.departures?.length ?? '?'}건)`, today.status === 200);

  console.log('\n[5] 예약 규칙');
  const pets = await call('GET', '/pets', { token: guardianToken });
  const kong = pets.data?.[0];
  check(`내 반려동물 목록 (${pets.data?.length}마리)`, pets.status === 200 && !!kong);

  const types = await call('GET', '/catalog/room-types', { token: guardianToken });
  const small = types.data?.find((t) => t.name === '소형');
  const large = types.data?.find((t) => t.name === '대형');
  check('객실 종류 조회', types.status === 200 && !!small);

  const avail = await call('GET', `/reservations/availability?checkIn=${day(40)}&checkOut=${day(42)}`, { token: guardianToken });
  check(`빈 방 수 조회 (소형 ${avail.data?.find((t) => t.name === '소형')?.freeRooms}개)`, avail.status === 200);

  rejected('퇴실이 입실보다 앞선 예약', await call('POST', '/reservations', {
    token: guardianToken,
    body: { checkInDate: day(42), checkOutDate: day(40), roomTypeId: small.id, petIds: [kong.id] },
  }));
  rejected('지난 날짜로 예약', await call('POST', '/reservations', {
    token: guardianToken,
    body: { checkInDate: day(-5), checkOutDate: day(-3), roomTypeId: small.id, petIds: [kong.id] },
  }));
  rejected('3.2kg 아이를 대형 방에', await call('POST', '/reservations', {
    token: guardianToken,
    body: { checkInDate: day(40), checkOutDate: day(42), roomTypeId: large.id, petIds: [kong.id] },
  }));
  rejected('남의 아이로 예약', await call('POST', '/reservations', {
    token: guardianToken,
    body: { checkInDate: day(40), checkOutDate: day(42), roomTypeId: small.id, petIds: [9999] },
  }));

  // 생후 5개월 미만 / 접종 만료 — 정겨울 보호자의 아이들
  const jung = await call('POST', '/auth/login', { body: { email: 'jung@example.test', password: GUARDIAN.password } });
  const jungToken = jung.data?.token;
  const jungPets = await call('GET', '/pets', { token: jungToken });
  const puppy = jungPets.data?.find((p) => p.name === '아람');
  const expired = jungPets.data?.find((p) => p.name === '호두');
  rejected('생후 5개월이 안 된 아이', await call('POST', '/reservations', {
    token: jungToken,
    body: { checkInDate: day(40), checkOutDate: day(42), roomTypeId: small.id, petIds: [puppy.id] },
  }));
  rejected('접종이 1년 지난 아이', await call('POST', '/reservations', {
    token: jungToken,
    body: { checkInDate: day(40), checkOutDate: day(42), roomTypeId: types.data.find((t) => t.name === '중형').id, petIds: [expired.id] },
  }));

  console.log('\n[6] 정상 예약과 금액 계산');
  const made = await call('POST', '/reservations', {
    token: guardianToken,
    body: { checkInDate: day(40), checkOutDate: day(43), roomTypeId: small.id, petIds: [kong.id] },
  });
  check(`예약 생성 (${made.data?.room?.number}호, ${made.data?.charge?.nightCount}박, 합계 ${made.data?.charge?.total?.toLocaleString()}원)`, made.status === 201);
  const weekendNights = made.data?.charge?.nights?.filter((n) => n.weekend).length ?? 0;
  check(`주말 밤 ${weekendNights}개를 가려냄 (금·토)`, made.data?.charge?.nights?.length === 3);

  console.log('\n[7] 내 것만 보기');
  const otherLogin = await call('POST', '/auth/login', { body: { email: 'lee@example.test', password: GUARDIAN.password } });
  rejected('남의 예약 상세 보기', await call('GET', `/reservations/${made.data.id}`, { token: otherLogin.data.token }), 403);

  console.log('\n[8] 취소와 환불');
  const canceled = await call('POST', `/reservations/${made.data.id}/cancel`, { token: guardianToken });
  check(`취소 → 상태 ${canceled.data?.status}`, canceled.data?.status === 'CANCELED');
  rejected('이미 취소한 예약을 또 취소', await call('POST', `/reservations/${made.data.id}/cancel`, { token: guardianToken }));

  console.log('\n[9] 직원 계정 관리 (관리자만)');
  const staffOnly = await call('POST', '/auth/staff/login', { body: { email: 'staff@kkoribyeol.test', password: ADMIN.password } });
  rejected('일반 직원이 계정 만들기', await call('POST', '/staff', {
    token: staffOnly.data?.token,
    body: { email: `s${Date.now()}@kkoribyeol.test`, name: '아무개', role: 'STAFF' },
  }), 403);

  const createdEmail = `s${Date.now()}@kkoribyeol.test`;
  const created = await call('POST', '/staff', { token: adminToken, body: { email: createdEmail, name: '새 직원', role: 'STAFF' } });
  check(`관리자가 직원 계정 생성 (임시 비밀번호 ${created.data?.tempPassword ? '발급됨' : '없음'})`, created.status === 201 && !!created.data?.tempPassword);

  console.log('\n[10] 임시 비밀번호는 반드시 바꿔야 한다');
  const firstLogin = await call('POST', '/auth/staff/login', { body: { email: createdEmail, password: created.data.tempPassword } });
  check('임시 비밀번호로 로그인되고 "바꿔야 함" 표시', firstLogin.data?.user?.mustChangePassword === true);
  rejected('비밀번호를 바꾸기 전에 다른 화면 열기', await call('GET', '/reservations/today', { token: firstLogin.data.token }), 403);
  const changed = await call('POST', '/auth/staff/change-password', {
    token: firstLogin.data.token,
    body: { currentPassword: created.data.tempPassword, newPassword: 'newpass1234' },
  });
  check('비밀번호 바꾸기', changed.status === 201);
  const afterChange = await call('POST', '/auth/staff/login', { body: { email: createdEmail, password: 'newpass1234' } });
  check('바꾼 비밀번호로 로그인하면 자유롭게 쓸 수 있다', (await call('GET', '/reservations/today', { token: afterChange.data.token })).status === 200);

  console.log('\n[11] 멈춘 계정은 로그인할 수 없다');
  await call('PATCH', `/staff/${created.data.staff.id}`, { token: adminToken, body: { isActive: false } });
  rejected('멈춘 계정으로 로그인', await call('POST', '/auth/staff/login', { body: { email: createdEmail, password: 'newpass1234' } }), 401);
  rejected('이미 받아 둔 토큰으로 접근', await call('GET', '/reservations/today', { token: afterChange.data.token }), 401);

  console.log(`\n결과: 통과 ${passed}, 실패 ${failed}\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
