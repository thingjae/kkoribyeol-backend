import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { Allow, CurrentUser, type Actor } from '../common/auth.js';
import { addDays, dateOnlyString, isValidDateString, toDateOnly, todayKst } from '../common/kst.js';

class PetDto {
  @IsString() @MinLength(1, { message: '이름을 적어 주세요.' }) name!: string;
  @IsString() @MinLength(1, { message: '종(품종)을 적어 주세요.' }) species!: string;
  @IsString() birthDate!: string;
  @IsNumber({}, { message: '몸무게를 숫자로 적어 주세요.' })
  @Min(0.1, { message: '몸무게가 너무 작아요.' })
  @Max(99, { message: '몸무게가 너무 커요.' })
  weightKg!: number;
  @IsString() vaccinatedAt!: string;
  @IsString() rabiesAt!: string;
  @IsString() @MinLength(1, { message: '먹는 사료를 적어 주세요.' }) food!: string;
  @IsOptional() @IsString() allergy?: string;
}

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  private checkDates(dto: PetDto) {
    const today = todayKst();
    for (const [label, value] of [
      ['생년월일', dto.birthDate],
      ['종합백신 접종일', dto.vaccinatedAt],
      ['광견병 접종일', dto.rabiesAt],
    ] as const) {
      if (!isValidDateString(value)) {
        throw new BadRequestException(`${label}을(를) YYYY-MM-DD 형식으로 적어 주세요.`);
      }
      if (value > today) {
        throw new BadRequestException(`${label}이(가) 오늘보다 뒤예요.`);
      }
    }
  }

  private shapePet(pet: {
    id: number;
    guardianId: number;
    name: string;
    species: string;
    birthDate: Date;
    weightKg: unknown;
    vaccinatedAt: Date;
    rabiesAt: Date;
    food: string;
    allergy: string;
  }) {
    return {
      id: pet.id,
      guardianId: pet.guardianId,
      name: pet.name,
      species: pet.species,
      birthDate: dateOnlyString(pet.birthDate),
      weightKg: Number(pet.weightKg),
      vaccinatedAt: dateOnlyString(pet.vaccinatedAt),
      rabiesAt: dateOnlyString(pet.rabiesAt),
      vaccineExpiresAt: addDays(dateOnlyString(pet.vaccinatedAt), 365),
      rabiesExpiresAt: addDays(dateOnlyString(pet.rabiesAt), 365),
      food: pet.food,
      allergy: pet.allergy,
    };
  }

  async myPets(actor: Actor) {
    if (actor.kind !== 'GUARDIAN') throw new ForbiddenException('보호자 계정만 쓸 수 있어요.');
    const pets = await this.prisma.pet.findMany({
      where: { guardianId: actor.id },
      orderBy: { id: 'asc' },
    });
    return pets.map((pet) => this.shapePet(pet));
  }

  async createPet(actor: Actor, dto: PetDto) {
    if (actor.kind !== 'GUARDIAN') throw new ForbiddenException('보호자 계정만 쓸 수 있어요.');
    this.checkDates(dto);
    const pet = await this.prisma.pet.create({
      data: {
        guardianId: actor.id,
        name: dto.name.trim(),
        species: dto.species.trim(),
        birthDate: toDateOnly(dto.birthDate),
        weightKg: dto.weightKg,
        vaccinatedAt: toDateOnly(dto.vaccinatedAt),
        rabiesAt: toDateOnly(dto.rabiesAt),
        food: dto.food.trim(),
        allergy: dto.allergy?.trim() ?? '',
      },
    });
    return this.shapePet(pet);
  }

  /** 보호자는 자기 아이만, 직원은 입실할 때 확인해서 고칠 수 있다 (고객 답 질문 8) */
  async updatePet(actor: Actor, id: number, dto: PetDto) {
    this.checkDates(dto);
    const pet = await this.prisma.pet.findUnique({ where: { id } });
    if (!pet) throw new NotFoundException('반려동물을 찾을 수 없어요.');
    if (actor.kind === 'GUARDIAN' && pet.guardianId !== actor.id) {
      throw new ForbiddenException('내가 등록한 아이만 고칠 수 있어요.');
    }

    const updated = await this.prisma.pet.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        species: dto.species.trim(),
        birthDate: toDateOnly(dto.birthDate),
        weightKg: dto.weightKg,
        vaccinatedAt: toDateOnly(dto.vaccinatedAt),
        rabiesAt: toDateOnly(dto.rabiesAt),
        food: dto.food.trim(),
        allergy: dto.allergy?.trim() ?? '',
      },
    });
    return this.shapePet(updated);
  }

  /** 반려동물 상세 + 지난 숙박 기록 (D-1) */
  async petDetail(actor: Actor, id: number) {
    const pet = await this.prisma.pet.findUnique({
      where: { id },
      include: {
        guardian: { select: { id: true, name: true, phone: true, emergencyPhone: true } },
        reservations: {
          include: { reservation: { include: { room: { include: { roomType: true } } } } },
        },
      },
    });
    if (!pet) throw new NotFoundException('반려동물을 찾을 수 없어요.');
    if (actor.kind === 'GUARDIAN' && pet.guardianId !== actor.id) {
      throw new ForbiddenException('내가 등록한 아이만 볼 수 있어요.');
    }

    const stays = pet.reservations
      .map((link) => link.reservation)
      .sort((a, b) => (a.checkInDate < b.checkInDate ? 1 : -1))
      .map((reservation) => ({
        id: reservation.id,
        status: reservation.status,
        checkInDate: dateOnlyString(reservation.checkInDate),
        checkOutDate: dateOnlyString(reservation.checkOutDate),
        roomNumber: reservation.room.roomNumber,
        roomTypeName: reservation.room.roomType.name,
      }));

    return { ...this.shapePet(pet), guardian: pet.guardian, stays };
  }

  /** 접종 만료가 30일 안으로 다가온 아이 (D-3) */
  async expiringVaccines() {
    const limit = addDays(todayKst(), 30);
    const pets = await this.prisma.pet.findMany({
      include: { guardian: { select: { name: true, phone: true } } },
      orderBy: { vaccinatedAt: 'asc' },
    });

    return pets
      .map((pet) => {
        const shaped = this.shapePet(pet);
        const soonest =
          shaped.vaccineExpiresAt < shaped.rabiesExpiresAt
            ? { kind: '종합백신', date: shaped.vaccineExpiresAt }
            : { kind: '광견병', date: shaped.rabiesExpiresAt };
        return { ...shaped, guardian: pet.guardian, soonest };
      })
      .filter((pet) => pet.soonest.date <= limit)
      .sort((a, b) => (a.soonest.date < b.soonest.date ? -1 : 1));
  }

  /** 보호자 검색 (D-5) — 이름 또는 연락처 뒷자리 */
  async searchGuardians(keyword?: string) {
    const trimmed = keyword?.trim() ?? '';
    const guardians = await this.prisma.guardian.findMany({
      where: trimmed
        ? {
            OR: [
              { name: { contains: trimmed, mode: 'insensitive' } },
              { phone: { contains: trimmed } },
            ],
          }
        : undefined,
      include: { pets: { select: { id: true, name: true, species: true } } },
      orderBy: { id: 'asc' },
      take: 100,
    });

    return guardians.map((guardian) => ({
      id: guardian.id,
      name: guardian.name,
      email: guardian.email,
      phone: guardian.phone,
      emergencyPhone: guardian.emergencyPhone,
      pets: guardian.pets,
    }));
  }

  async me(actor: Actor) {
    if (actor.kind !== 'GUARDIAN') throw new ForbiddenException('보호자 계정만 쓸 수 있어요.');
    const guardian = await this.prisma.guardian.findUniqueOrThrow({ where: { id: actor.id } });
    return {
      id: guardian.id,
      name: guardian.name,
      email: guardian.email,
      phone: guardian.phone,
      emergencyPhone: guardian.emergencyPhone,
    };
  }
}

@Controller()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Allow('GUARDIAN')
  @Get('me')
  me(@CurrentUser() actor: Actor) {
    return this.people.me(actor);
  }

  @Allow('GUARDIAN')
  @Get('pets')
  myPets(@CurrentUser() actor: Actor) {
    return this.people.myPets(actor);
  }

  @Allow('GUARDIAN')
  @Post('pets')
  createPet(@CurrentUser() actor: Actor, @Body() dto: PetDto) {
    return this.people.createPet(actor, dto);
  }

  @Allow('STAFF')
  @Get('pets/expiring-vaccines')
  expiring() {
    return this.people.expiringVaccines();
  }

  @Get('pets/:id')
  petDetail(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.people.petDetail(actor, id);
  }

  @Patch('pets/:id')
  updatePet(
    @CurrentUser() actor: Actor,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PetDto,
  ) {
    return this.people.updatePet(actor, id, dto);
  }

  @Allow('STAFF')
  @Get('guardians')
  guardians(@Query('keyword') keyword?: string) {
    return this.people.searchGuardians(keyword);
  }
}

@Module({ controllers: [PeopleController], providers: [PeopleService] })
export class PeopleModule {}
