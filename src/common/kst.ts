// 날짜는 모두 한국 시간(KST) 기준으로 센다.
// DB의 date 칸은 UTC 자정으로 들어오므로, 꺼낼 때도 UTC 기준으로 읽어야 하루가 밀리지 않는다.

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 오늘 날짜 (한국 시간) 'YYYY-MM-DD' */
export function todayKst(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 지금 시각 (저장용) */
export function nowKstIso(): Date {
  return new Date();
}

/** 'YYYY-MM-DD' → DB에 넣을 Date (UTC 자정) */
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** DB에서 꺼낸 Date → 'YYYY-MM-DD' */
export function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 형식인지 + 실제 있는 날짜인지 */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** b - a (날짜 수). 둘 다 'YYYY-MM-DD' */
export function diffDays(a: string, b: string): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / DAY_MS);
}

/** 'YYYY-MM-DD'에 n일 더하기 */
export function addDays(value: string, n: number): string {
  return new Date(toDateOnly(value).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 묵는 밤들의 날짜 목록.
 * 체크인 11/1, 체크아웃 11/4 → ['11-01','11-02','11-03'] (3박)
 * 나가는 날은 자지 않으므로 제외한다. 방 겹침을 반열림 구간으로 보는 것과 같은 기준.
 */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(d);
  return nights;
}

/**
 * 주말 요금이 붙는 밤인가?
 * 고객 답(질문 3): 금요일 밤과 토요일 밤이 주말이다.
 * getUTCDay() → 0 일, 1 월 ... 5 금, 6 토
 */
export function isWeekendNight(date: string): boolean {
  const day = toDateOnly(date).getUTCDay();
  return day === 5 || day === 6;
}

/** 생후 개월 수 (기준일 시점) */
export function monthsOld(birthDate: string, on: string): number {
  const b = toDateOnly(birthDate);
  const o = toDateOnly(on);
  let months = (o.getUTCFullYear() - b.getUTCFullYear()) * 12 + (o.getUTCMonth() - b.getUTCMonth());
  if (o.getUTCDate() < b.getUTCDate()) months -= 1;
  return months;
}

/** 이번 달의 첫날과 다음 달 첫날 (한국 시간 기준) */
export function thisMonthRange(): { start: string; end: string } {
  const today = todayKst();
  const start = `${today.slice(0, 7)}-01`;
  const [y, m] = start.split('-').map(Number);
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start, end };
}
