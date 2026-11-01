import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { Allow, CurrentUser, type Actor } from '../common/auth.js';
import { dateOnlyString, isValidDateString, toDateOnly, todayKst } from '../common/kst.js';
import {
  heaviestWeight,
  petEntryProblem,
  refundAmount,
  refundReason,
  roomTypeForWeight,
  serviceLines,
  stayBreakdown,
} from './reservation.logic.js';

class ServiceRequestDto {
  @IsInt() serviceId!: number;
  @IsInt() @Min(1, { message: '서비스 횟수는 1회 이상이어야 합니다.' }) count!: number;
}

class CreateReservationDto {
  @IsString() checkInDate!: string;
  @IsString() checkOutDate!: string;
  @IsInt() roomTypeId!: number;

  @IsArray()
  @ArrayMinSize(1, { message: '맡길 아이를 한 마리 이상 골라 주세요.' })
  @ArrayMaxSize(2, { message: '한 예약에는 두 마리까지만 넣을 수 있어요. 세 마리면 예약을 나눠 주세요.' })
  @IsInt({ each: true })
  petIds!: number[];

  @IsOptional()
  @IsArray()
  @Type(() => ServiceRequestDto)
  services?: ServiceRequestDto[];
}

const ACTIVE = { status: { not: 'CANCELED' as const } };

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertDates(checkIn: string, checkOut: string) {
    if (!isValidDateString(checkIn) || !isValidDateString(checkOut)) {
      throw new BadRequestException('날짜를 YYYY-MM-DD 형식으로 골라 주세요.');
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException('퇴실 날짜는 입실 날짜보다 뒤여야 해요.');
    }
  }

  /** 날짜를 고르면 객실 종류별로 빈 방이 몇 개인지 (요구사항 C-3) */
  async availability(checkIn: string, checkOut: string) {
    this.assertDates(checkIn, checkOut);

    const types = await this.prisma.roomType.findMany({
      orderBy: { minWeight: 'asc' },
      include: { rooms: { orderBy: { roomNumber: 'asc' } } },
    });

    const taken = await this.prisma.reservation.findMany({
      where: {
        ...ACTIVE,
        checkInDate: { lt: toDateOnly(checkOut) },
        checkOutDate: { gt: toDateOnly(checkIn) },
      },
      select: { roomId: true },
    });
    const takenIds = new Set(taken.map((r) => r.roomId));

    return types.map((type) => {
      const free = type.rooms.filter((room) => !takenIds.has(room.id));
      return {
        id: type.id,
        name: type.name,
        minWeight: Number(type.minWeight),
        maxWeight: type.maxWeight === null ? null : Number(type.maxWeight),
        weekdayPrice: type.weekdayPrice,
        weekendPrice: type.weekendPrice,
        totalRooms: type.rooms.length,
        freeRooms: free.length,
      };
    });
  }

  async create(actor: Actor, dto: CreateReservationDto) {
    if (actor.kind !== 'GUARDIAN') throw new ForbiddenException('보호자 계정으로 신청해 주세요.');
    this.assertDates(dto.checkInDate, dto.checkOutDate);

    if (dto.checkInDate < todayKst()) {
      throw new BadRequestException('지난 날짜로는 예약할 수 없어요.');
    }

    // 1) 내 아이인지 (다른 보호자의 아이를 넣을 수 없다)
    const uniquePetIds = [...new Set(dto.petIds)];
    if (uniquePetIds.length !== dto.petIds.length) {
      throw new BadRequestException('같은 아이를 두 번 넣을 수 없어요.');
    }
    const pets = await this.prisma.pet.findMany({
      where: { id: { in: uniquePetIds }, guardianId: actor.id },
    });
    if (pets.length !== uniquePetIds.length) {
      throw new BadRequestException('내가 등록한 아이만 맡길 수 있어요.');
    }

    // 2) 입실 조건 (접종 1년 이내, 생후 5개월 이상)
    for (const pet of pets) {
      const problem = petEntryProblem(
        {
          name: pet.name,
          birthDate: dateOnlyString(pet.birthDate),
          weightKg: Number(pet.weightKg),
          vaccinatedAt: dateOnlyString(pet.vaccinatedAt),
          rabiesAt: dateOnlyString(pet.rabiesAt),
        },
        dto.checkInDate,
      );
      if (problem) throw new BadRequestException(problem);
    }

    // 3) 몸무게에 맞는 방 종류인가 (두 마리면 무거운 쪽 기준)
    const types = await this.prisma.roomType.findMany({ orderBy: { minWeight: 'asc' } });
    const ranges = types.map((t) => ({
      id: t.id,
      name: t.name,
      minWeight: Number(t.minWeight),
      maxWeight: t.maxWeight === null ? null : Number(t.maxWeight),
    }));
    const weight = heaviestWeight(pets.map((p) => ({ weightKg: Number(p.weightKg) })));
    const fit = roomTypeForWeight(ranges, weight);
    if (!fit) throw new BadRequestException('몸무게에 맞는 객실 종류가 없어요. 전화로 문의해 주세요.');
    if (fit.id !== dto.roomTypeId) {
      const chosen = ranges.find((t) => t.id === dto.roomTypeId);
      throw new BadRequestException(
        `${weight}kg이면 ${fit.name} 객실만 쓸 수 있어요.${chosen ? ` ${chosen.name}은 고를 수 없어요.` : ''}`,
      );
    }

    // 4) 서비스 확인
    const serviceRequests = (dto.services ?? []).filter((s) => s.count > 0);
    if (serviceRequests.length) {
      const ids = serviceRequests.map((s) => s.serviceId);
      const found = await this.prisma.service.findMany({ where: { id: { in: ids }, isActive: true } });
      if (found.length !== new Set(ids).size) {
        throw new BadRequestException('고를 수 없는 추가 서비스가 있어요.');
      }
    }

    // 5) 빈 방 하나 고르기 (보호자는 종류만 고르고 방 번호는 자동 배정 — 고객 답 질문 7)
    const rooms = await this.prisma.room.findMany({
      where: { roomTypeId: fit.id },
      orderBy: { roomNumber: 'asc' },
    });
    const taken = await this.prisma.reservation.findMany({
      where: {
        ...ACTIVE,
        roomId: { in: rooms.map((r) => r.id) },
        checkInDate: { lt: toDateOnly(dto.checkOutDate) },
        checkOutDate: { gt: toDateOnly(dto.checkInDate) },
      },
      select: { roomId: true },
    });
    const takenIds = new Set(taken.map((r) => r.roomId));
    const room = rooms.find((r) => !takenIds.has(r.id));
    if (!room) throw new BadRequestException(`그 날짜에는 ${fit.name} 객실이 모두 찼어요.`);

    // 6) 저장. 같은 방 겹침은 DB가 최종적으로 막는다(EXCLUDE).
    try {
      const created = await this.prisma.reservation.create({
        data: {
          guardianId: actor.id,
          roomId: room.id,
          checkInDate: toDateOnly(dto.checkInDate),
          checkOutDate: toDateOnly(dto.checkOutDate),
          pets: { create: uniquePetIds.map((petId) => ({ petId })) },
          services: {
            create: serviceRequests.map((s) => ({ serviceId: s.serviceId, count: s.count })),
          },
        },
      });
      return this.detail(actor, created.id);
    } catch (error) {
      if (String(error).includes('reservation_no_overlap')) {
        throw new BadRequestException('방금 그 방이 먼저 예약되었어요. 다시 시도해 주세요.');
      }
      throw error;
    }
  }

  async list(actor: Actor, query: { status?: string; date?: string; keyword?: string }) {
    const where: Record<string, unknown> = {};
    if (actor.kind === 'GUARDIAN') where.guardianId = actor.id;
    if (query.status) where.status = query.status;
    if (query.date && isValidDateString(query.date)) {
      where.checkInDate = { lte: toDateOnly(query.date) };
      where.checkOutDate = { gt: toDateOnly(query.date) };
    }
    if (actor.kind === 'STAFF' && query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { guardian: { name: { contains: keyword, mode: 'insensitive' } } },
        { guardian: { phone: { contains: keyword } } },
        { pets: { some: { pet: { name: { contains: keyword, mode: 'insensitive' } } } } },
      ];
    }

    const rows = await this.prisma.reservation.findMany({
      where,
      orderBy: [{ checkInDate: 'desc' }, { id: 'desc' }],
      include: {
        guardian: { select: { id: true, name: true, phone: true } },
        room: { include: { roomType: true } },
        pets: { include: { pet: { select: { id: true, name: true, species: true } } } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      checkInDate: dateOnlyString(row.checkInDate),
      checkOutDate: dateOnlyString(row.checkOutDate),
      roomNumber: row.room.roomNumber,
      roomTypeName: row.room.roomType.name,
      guardian: row.guardian,
      pets: row.pets.map((p) => p.pet),
    }));
  }

  async detail(actor: Actor, id: number) {
    const row = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        guardian: { select: { id: true, name: true, phone: true, emergencyPhone: true } },
        room: { include: { roomType: true } },
        pets: { include: { pet: true } },
        services: { include: { service: true } },
      },
    });
    if (!row) throw new NotFoundException('예약을 찾을 수 없어요.');
    // 고객은 자기 예약만 본다
    if (actor.kind === 'GUARDIAN' && row.guardianId !== actor.id) {
      throw new ForbiddenException('내 예약만 볼 수 있어요.');
    }

    const checkIn = dateOnlyString(row.checkInDate);
    const checkOut = dateOnlyString(row.checkOutDate);
    const stay = stayBreakdown(checkIn, checkOut, row.room.roomType);
    const lines = serviceLines(row.services);
    const serviceTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const total = stay.roomTotal + serviceTotal;
    const today = todayKst();

    return {
      id: row.id,
      status: row.status,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      room: { id: row.room.id, number: row.room.roomNumber, typeName: row.room.roomType.name },
      guardian: row.guardian,
      pets: row.pets.map((p) => ({
        id: p.pet.id,
        name: p.pet.name,
        species: p.pet.species,
        weightKg: Number(p.pet.weightKg),
        food: p.pet.food,
        allergy: p.pet.allergy,
      })),
      checkedInAt: row.checkedInAt,
      checkedOutAt: row.checkedOutAt,
      canceledAt: row.canceledAt,
      charge: {
        nights: stay.nights,
        nightCount: stay.nightCount,
        roomTotal: stay.roomTotal,
        services: lines,
        serviceTotal,
        total,
      },
      // 지금 취소하면 얼마나 돌려받는지 (저장하지 않고 계산한다)
      refundIfCanceledToday:
        row.status === 'RESERVED'
          ? { amount: refundAmount(total, checkIn, today), reason: refundReason(checkIn, today) }
          : null,
    };
  }

  async cancel(actor: Actor, id: number) {
    const row = await this.prisma.reservation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('예약을 찾을 수 없어요.');
    if (actor.kind === 'GUARDIAN' && row.guardianId !== actor.id) {
      throw new ForbiddenException('내 예약만 취소할 수 있어요.');
    }
    if (row.status !== 'RESERVED') {
      throw new BadRequestException('이미 입실했거나 끝난 예약은 취소할 수 없어요.');
    }

    await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    return this.detail(actor, id);
  }

  async checkIn(actor: Actor, id: number) {
    const row = await this.prisma.reservation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('예약을 찾을 수 없어요.');
    if (row.status !== 'RESERVED') throw new BadRequestException('예약됨 상태에서만 입실할 수 있어요.');

    await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CHECKED_IN', checkedInAt: new Date() },
    });
    return this.detail(actor, id);
  }

  async checkOut(actor: Actor, id: number) {
    const row = await this.prisma.reservation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('예약을 찾을 수 없어요.');
    if (row.status !== 'CHECKED_IN') throw new BadRequestException('입실한 예약만 퇴실할 수 있어요.');

    await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CHECKED_OUT', checkedOutAt: new Date() },
    });
    return this.detail(actor, id);
  }

  /** 오늘 입실·퇴실 예정 (요구사항 C-2) + 사료·알레르기 (D-2) */
  async today() {
    const today = toDateOnly(todayKst());
    const include = {
      guardian: { select: { name: true, phone: true, emergencyPhone: true } },
      room: { include: { roomType: true } },
      pets: { include: { pet: true } },
    };

    const [arrivals, departures] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { ...ACTIVE, checkInDate: today },
        include,
        orderBy: { id: 'asc' },
      }),
      this.prisma.reservation.findMany({
        where: { ...ACTIVE, checkOutDate: today },
        include,
        orderBy: { id: 'asc' },
      }),
    ]);

    const shape = (rows: typeof arrivals) =>
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        roomNumber: row.room.roomNumber,
        roomTypeName: row.room.roomType.name,
        guardian: row.guardian,
        checkInDate: dateOnlyString(row.checkInDate),
        checkOutDate: dateOnlyString(row.checkOutDate),
        pets: row.pets.map((p) => ({
          name: p.pet.name,
          species: p.pet.species,
          food: p.pet.food,
          allergy: p.pet.allergy,
        })),
      }));

    return { date: todayKst(), arrivals: shape(arrivals), departures: shape(departures) };
  }
}

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('availability')
  availability(@Query('checkIn') checkIn: string, @Query('checkOut') checkOut: string) {
    return this.reservations.availability(checkIn, checkOut);
  }

  @Allow('STAFF')
  @Get('today')
  today() {
    return this.reservations.today();
  }

  @Allow('GUARDIAN')
  @Post()
  create(@CurrentUser() actor: Actor, @Body() dto: CreateReservationDto) {
    return this.reservations.create(actor, dto);
  }

  @Get()
  list(
    @CurrentUser() actor: Actor,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.reservations.list(actor, { status, date, keyword });
  }

  @Get(':id')
  detail(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.detail(actor, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.cancel(actor, id);
  }

  @Allow('STAFF')
  @Post(':id/check-in')
  checkIn(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.checkIn(actor, id);
  }

  @Allow('STAFF')
  @Post(':id/check-out')
  checkOut(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.checkOut(actor, id);
  }
}

@Module({ controllers: [ReservationsController], providers: [ReservationsService] })
export class ReservationsModule {}
