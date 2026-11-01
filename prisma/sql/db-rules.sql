-- 꼬리별: DB가 직접 지키는 규칙
-- Prisma가 만들지 못하는 CHECK·EXCLUDE를 마이그레이션에 덧붙인다.
-- Prisma 7은 직접 쓴 SQL에 스키마 이름을 붙여야 한다.

-- 한 칸(=)과 구간(&&)을 함께 쓰는 제외 제약에 필요
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 체크아웃은 체크인보다 늦어야 한다 (B-1)
ALTER TABLE "hw2"."reservation"
  ADD CONSTRAINT "reservation_dates_check"
  CHECK ("check_out_date" > "check_in_date");

-- 추가 서비스 횟수는 1회 이상 (B-7)
ALTER TABLE "hw2"."reservation_service"
  ADD CONSTRAINT "reservation_service_count_check"
  CHECK ("count" >= 1);

-- 같은 방은 날짜가 겹치게 예약할 수 없다 (B-3)
--   '[)' = 시작일 포함, 퇴실일 제외.
--   → 앞 손님 퇴실일에 다음 손님이 들어오는 것은 겹침이 아니다 (고객 질문 2의 답)
--   취소된 예약은 자리를 잡지 않으므로 제외한다
ALTER TABLE "hw2"."reservation"
  ADD CONSTRAINT "reservation_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("check_in_date", "check_out_date", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELED');
