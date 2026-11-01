import { diffDays, isWeekendNight, monthsOld, nightsOf } from '../common/kst.js';

/**
 * 돈과 관련된 값은 저장하지 않고 그때그때 계산한다.
 * 저장해 두면 날짜나 서비스가 바뀔 때 같이 고쳐야 해서 금방 어긋난다.
 */

export type NightPrice = { date: string; weekend: boolean; price: number };

export type StayBreakdown = {
  nights: NightPrice[];
  nightCount: number;
  roomTotal: number;
};

/** 숙박비: 밤마다 평일·주말을 따져서 더한다 */
export function stayBreakdown(
  checkIn: string,
  checkOut: string,
  rate: { weekdayPrice: number; weekendPrice: number },
): StayBreakdown {
  const nights = nightsOf(checkIn, checkOut).map((date) => {
    const weekend = isWeekendNight(date);
    return { date, weekend, price: weekend ? rate.weekendPrice : rate.weekdayPrice };
  });
  return {
    nights,
    nightCount: nights.length,
    roomTotal: nights.reduce((sum, night) => sum + night.price, 0),
  };
}

export type ServiceLine = { name: string; unitPrice: number; count: number; amount: number };

export function serviceLines(
  items: { count: number; service: { name: string; price: number } }[],
): ServiceLine[] {
  return items.map((item) => ({
    name: item.service.name,
    unitPrice: item.service.price,
    count: item.count,
    amount: item.service.price * item.count,
  }));
}

/**
 * 환불 비율 (규정 + 고객 답 질문 10: 날짜 기준)
 * 체크인 3일 전까지 전액, 2일 전~전날 50%, 당일 0%
 */
export function refundRate(checkInDate: string, canceledOn: string): number {
  const daysLeft = diffDays(canceledOn, checkInDate);
  if (daysLeft >= 3) return 1;
  if (daysLeft >= 1) return 0.5;
  return 0;
}

export function refundAmount(total: number, checkInDate: string, canceledOn: string): number {
  return Math.round(total * refundRate(checkInDate, canceledOn));
}

export function refundReason(checkInDate: string, canceledOn: string): string {
  const daysLeft = diffDays(canceledOn, checkInDate);
  if (daysLeft >= 3) return '체크인 3일 전까지 취소라 전액 환불됩니다.';
  if (daysLeft >= 1) return '체크인 2일 전~전날 취소라 50%만 환불됩니다.';
  return '체크인 당일(또는 이후) 취소라 환불되지 않습니다.';
}

/* ───────── 입실 조건 (백엔드가 막는 규칙) ───────── */

export type PetForCheck = {
  name: string;
  birthDate: string;
  weightKg: number;
  vaccinatedAt: string;
  rabiesAt: string;
};

/** 접종 1년 이내 + 생후 5개월 이상. 체크인 날짜가 기준이다 */
export function petEntryProblem(pet: PetForCheck, checkInDate: string): string | null {
  if (monthsOld(pet.birthDate, checkInDate) < 5) {
    return `${pet.name}: 생후 5개월이 지나야 맡길 수 있어요.`;
  }
  if (diffDays(pet.vaccinatedAt, checkInDate) > 365) {
    return `${pet.name}: 종합백신 접종이 1년을 넘었어요. 다시 맞고 와 주세요.`;
  }
  if (diffDays(pet.rabiesAt, checkInDate) > 365) {
    return `${pet.name}: 광견병 접종이 1년을 넘었어요. 다시 맞고 와 주세요.`;
  }
  return null;
}

export type RoomTypeRange = {
  id: number;
  name: string;
  minWeight: number;
  maxWeight: number | null;
};

/** 몸무게에 맞는 객실 종류 하나 (두 마리면 무거운 쪽 기준) */
export function roomTypeForWeight(types: RoomTypeRange[], weight: number): RoomTypeRange | null {
  return (
    types.find((t) => weight >= t.minWeight && (t.maxWeight === null || weight < t.maxWeight)) ??
    null
  );
}

export function heaviestWeight(pets: { weightKg: number }[]): number {
  return pets.reduce((max, pet) => Math.max(max, pet.weightKg), 0);
}
