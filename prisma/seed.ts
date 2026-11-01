import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// 빈 화면을 보지 않도록 가상 데이터를 채운다. 실제 개인정보는 쓰지 않는다.
// 다시 실행하면 hw2 공간의 데이터를 비우고 처음부터 다시 넣는다.

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL 설정값이 없습니다.');
const schema = new URL(url).searchParams.get('schema') ?? 'public';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }, { schema }),
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
});

const DAY = 24 * 60 * 60 * 1000;
const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const day = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + n * DAY);
const dateOf = (value: string) => new Date(`${value}T00:00:00Z`);
const hash = (plain: string) => bcrypt.hash(plain, 10);

async function main() {
  console.log(`[seed] 스키마 ${schema}, 오늘 ${today}`);

  // 순서대로 비운다 (자식 → 부모)
  await prisma.reservationService.deleteMany();
  await prisma.reservationPet.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.pet.deleteMany();
  await prisma.guardian.deleteMany();
  await prisma.room.deleteMany();
  await prisma.roomType.deleteMany();
  await prisma.service.deleteMany();
  await prisma.staff.deleteMany();

  /* 직원 계정 — 회원가입이 없다. 첫 관리자만 미리 넣어 둔다 */
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@kkoribyeol.test').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD 설정값이 없습니다. backend/.env에 넣어 주세요.');
  }
  await prisma.staff.createMany({
    data: [
      { email: adminEmail, name: '원장 한지우', role: 'ADMIN', passwordHash: await hash(adminPassword) },
      {
        email: 'staff@kkoribyeol.test',
        name: '직원 오민재',
        role: 'STAFF',
        passwordHash: await hash(process.env.SEED_STAFF_PASSWORD ?? adminPassword),
      },
    ],
  });

  /* 객실 종류와 방 (규정: 소형 40,000 / 중형 55,000 / 대형 70,000, 주말 +10,000) */
  const small = await prisma.roomType.create({
    data: { name: '소형', minWeight: 0, maxWeight: 7, weekdayPrice: 40_000, weekendPrice: 50_000 },
  });
  const medium = await prisma.roomType.create({
    data: { name: '중형', minWeight: 7, maxWeight: 15, weekdayPrice: 55_000, weekendPrice: 65_000 },
  });
  const large = await prisma.roomType.create({
    data: { name: '대형', minWeight: 15, maxWeight: null, weekdayPrice: 70_000, weekendPrice: 80_000 },
  });

  await prisma.room.createMany({
    data: [
      ...['101', '102', '103', '104'].map((roomNumber) => ({ roomTypeId: small.id, roomNumber })),
      ...['201', '202', '203'].map((roomNumber) => ({ roomTypeId: medium.id, roomNumber })),
      ...['301', '302'].map((roomNumber) => ({ roomTypeId: large.id, roomNumber })),
    ],
  });
  const rooms = await prisma.room.findMany({ orderBy: { roomNumber: 'asc' } });
  const roomBy = (roomNumber: string) => rooms.find((room) => room.roomNumber === roomNumber)!.id;

  /* 추가 서비스 */
  const [walk, bath, nail] = await Promise.all([
    prisma.service.create({ data: { name: '산책 (30분)', price: 15_000 } }),
    prisma.service.create({ data: { name: '목욕', price: 30_000 } }),
    prisma.service.create({ data: { name: '발톱 손질', price: 10_000 } }),
  ]);

  /* 보호자와 반려동물 (모두 가상) */
  const guardianPassword = await hash(process.env.SEED_GUARDIAN_PASSWORD ?? 'kkori1234');
  const makeGuardian = (
    email: string,
    name: string,
    phone: string,
    emergencyPhone: string,
  ) => ({ email, name, phone, emergencyPhone, passwordHash: guardianPassword });

  const g1 = await prisma.guardian.create({
    data: {
      ...makeGuardian('kim@example.test', '김보호', '010-1111-2222', '010-1111-3333'),
      pets: {
        create: [
          {
            name: '콩이',
            species: '말티즈',
            birthDate: dateOf('2022-03-14'),
            weightKg: 3.2,
            vaccinatedAt: day(-120),
            rabiesAt: day(-120),
            food: '로얄캐닌 미니 어덜트',
            allergy: '닭고기',
          },
        ],
      },
    },
    include: { pets: true },
  });

  const g2 = await prisma.guardian.create({
    data: {
      ...makeGuardian('lee@example.test', '이사랑', '010-2222-4444', '010-2222-5555'),
      pets: {
        create: [
          {
            name: '초코',
            species: '비글',
            birthDate: dateOf('2021-07-02'),
            weightKg: 9.5,
            vaccinatedAt: day(-200),
            rabiesAt: day(-200),
            food: '오리젠 퍼피',
            allergy: '',
          },
        ],
      },
    },
    include: { pets: true },
  });

  const g3 = await prisma.guardian.create({
    data: {
      ...makeGuardian('park@example.test', '박하늘', '010-3333-6666', '010-3333-7777'),
      pets: {
        create: [
          {
            name: '두부',
            species: '골든리트리버',
            birthDate: dateOf('2020-11-20'),
            weightKg: 28.4,
            // 접종 만료가 20일 뒤 → 접종 임박 목록(D-3)에 뜬다
            vaccinatedAt: day(-345),
            rabiesAt: day(-300),
            food: '내추럴발란스 라지브리드',
            allergy: '소고기',
          },
        ],
      },
    },
    include: { pets: true },
  });

  const g4 = await prisma.guardian.create({
    data: {
      ...makeGuardian('choi@example.test', '최다정', '010-4444-8888', '010-4444-9999'),
      pets: {
        create: [
          {
            name: '보리',
            species: '말티푸',
            birthDate: dateOf('2023-01-09'),
            weightKg: 4.1,
            vaccinatedAt: day(-60),
            rabiesAt: day(-60),
            food: '하림 더리얼',
            allergy: '',
          },
          {
            name: '감자',
            species: '포메라니안',
            birthDate: dateOf('2023-05-30'),
            weightKg: 3.0,
            vaccinatedAt: day(-60),
            rabiesAt: day(-60),
            food: '하림 더리얼',
            allergy: '유제품',
          },
        ],
      },
    },
    include: { pets: true },
  });

  // 거절 규칙을 눌러 볼 수 있게: 생후 5개월이 안 된 아이, 접종이 지난 아이
  const g5 = await prisma.guardian.create({
    data: {
      ...makeGuardian('jung@example.test', '정겨울', '010-5555-1234', '010-5555-4321'),
      pets: {
        create: [
          {
            name: '아람',
            species: '시바견',
            birthDate: day(-90), // 생후 3개월 → 예약하면 거절된다
            weightKg: 5.2,
            vaccinatedAt: day(-30),
            rabiesAt: day(-30),
            food: '퍼피 사료',
            allergy: '',
          },
          {
            name: '호두',
            species: '웰시코기',
            birthDate: dateOf('2019-04-18'),
            weightKg: 12.6,
            vaccinatedAt: day(-400), // 1년이 지남 → 예약하면 거절된다
            rabiesAt: day(-400),
            food: '뉴트로 내추럴초이스',
            allergy: '',
          },
        ],
      },
    },
    include: { pets: true },
  });

  /* 예약 */
  const make = async (
    guardianId: number,
    roomNumber: string,
    from: number,
    to: number,
    petIds: number[],
    status: 'RESERVED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELED',
    services: { serviceId: number; count: number }[] = [],
  ) => {
    await prisma.reservation.create({
      data: {
        guardianId,
        roomId: roomBy(roomNumber),
        checkInDate: day(from),
        checkOutDate: day(to),
        status,
        checkedInAt: status === 'CHECKED_IN' || status === 'CHECKED_OUT' ? day(from) : null,
        checkedOutAt: status === 'CHECKED_OUT' ? day(to) : null,
        canceledAt: status === 'CANCELED' ? day(-2) : null,
        pets: { create: petIds.map((petId) => ({ petId })) },
        services: { create: services },
      },
    });
  };

  // 오늘 입실 예정
  await make(g1.id, '101', 0, 2, [g1.pets[0].id], 'RESERVED', [{ serviceId: walk.id, count: 2 }]);
  // 오늘 퇴실 예정 (지금 묵고 있는 중)
  await make(g2.id, '201', -3, 0, [g2.pets[0].id], 'CHECKED_IN', [{ serviceId: bath.id, count: 1 }]);
  // 앞으로 잡힌 예약
  await make(g3.id, '301', 5, 8, [g3.pets[0].id], 'RESERVED', [
    { serviceId: walk.id, count: 3 },
    { serviceId: nail.id, count: 1 },
  ]);
  // 두 마리를 한 방에 (무거운 쪽 4.1kg 기준 → 소형)
  await make(g4.id, '102', 3, 6, [g4.pets[0].id, g4.pets[1].id], 'RESERVED');
  // 지난 숙박 기록
  await make(g1.id, '103', -20, -17, [g1.pets[0].id], 'CHECKED_OUT', [{ serviceId: bath.id, count: 1 }]);
  // 취소된 예약
  await make(g5.id, '202', 10, 12, [g5.pets[1].id], 'CANCELED');

  const counts = {
    직원: await prisma.staff.count(),
    보호자: await prisma.guardian.count(),
    반려동물: await prisma.pet.count(),
    객실: await prisma.room.count(),
    예약: await prisma.reservation.count(),
  };
  console.log('[seed] 완료', counts);
  console.log(`[seed] 관리자 ${adminEmail} / 직원 staff@kkoribyeol.test`);
  console.log('[seed] 보호자 로그인 예: kim@example.test');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
