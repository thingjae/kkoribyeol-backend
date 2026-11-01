-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELED');

-- CreateTable
CREATE TABLE "guardian" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "emergency_phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'STAFF',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet" (
    "id" SERIAL NOT NULL,
    "guardian_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "weight_kg" DECIMAL(4,1) NOT NULL,
    "vaccinated_at" DATE NOT NULL,
    "rabies_at" DATE NOT NULL,
    "food" TEXT NOT NULL,
    "allergy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "pet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "min_weight" DECIMAL(4,1) NOT NULL,
    "max_weight" DECIMAL(4,1),
    "weekday_price" INTEGER NOT NULL,
    "weekend_price" INTEGER NOT NULL,

    CONSTRAINT "room_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" SERIAL NOT NULL,
    "room_type_id" INTEGER NOT NULL,
    "room_number" TEXT NOT NULL,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation" (
    "id" SERIAL NOT NULL,
    "guardian_id" INTEGER NOT NULL,
    "room_id" INTEGER NOT NULL,
    "check_in_date" DATE NOT NULL,
    "check_out_date" DATE NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_pet" (
    "reservation_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,

    CONSTRAINT "reservation_pet_pkey" PRIMARY KEY ("reservation_id","pet_id")
);

-- CreateTable
CREATE TABLE "reservation_service" (
    "id" SERIAL NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "reservation_service_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guardian_email_key" ON "guardian"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE INDEX "pet_guardian_id_idx" ON "pet"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_name_key" ON "room_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "room_room_number_key" ON "room"("room_number");

-- CreateIndex
CREATE UNIQUE INDEX "service_name_key" ON "service"("name");

-- CreateIndex
CREATE INDEX "reservation_check_in_date_idx" ON "reservation"("check_in_date");

-- CreateIndex
CREATE INDEX "reservation_check_out_date_idx" ON "reservation"("check_out_date");

-- CreateIndex
CREATE INDEX "reservation_guardian_id_idx" ON "reservation"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_service_reservation_id_service_id_key" ON "reservation_service"("reservation_id", "service_id");

-- AddForeignKey
ALTER TABLE "pet" ADD CONSTRAINT "pet_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_pet" ADD CONSTRAINT "reservation_pet_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_pet" ADD CONSTRAINT "reservation_pet_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_service" ADD CONSTRAINT "reservation_service_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_service" ADD CONSTRAINT "reservation_service_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== 여기부터 직접 쓴 규칙 (Prisma가 만들지 못하는 CHECK·EXCLUDE) =====
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
