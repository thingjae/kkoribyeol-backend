import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { Allow } from '../common/auth.js';

class ServiceDto {
  @IsString() @MinLength(1, { message: '서비스 이름을 적어 주세요.' }) name!: string;
  @IsInt() @Min(0, { message: '가격은 0원 이상이어야 해요.' }) price!: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class RoomDto {
  @IsInt() roomTypeId!: number;
  @IsString() @MinLength(1, { message: '방 번호를 적어 주세요.' }) roomNumber!: string;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async roomTypes() {
    const types = await this.prisma.roomType.findMany({
      orderBy: { minWeight: 'asc' },
      include: { _count: { select: { rooms: true } } },
    });
    return types.map((type) => ({
      id: type.id,
      name: type.name,
      minWeight: Number(type.minWeight),
      maxWeight: type.maxWeight === null ? null : Number(type.maxWeight),
      weekdayPrice: type.weekdayPrice,
      weekendPrice: type.weekendPrice,
      roomCount: type._count.rooms,
    }));
  }

  async rooms() {
    const rooms = await this.prisma.room.findMany({
      include: { roomType: true },
      orderBy: { roomNumber: 'asc' },
    });
    return rooms.map((room) => ({
      id: room.id,
      roomNumber: room.roomNumber,
      roomTypeId: room.roomTypeId,
      roomTypeName: room.roomType.name,
    }));
  }

  services(onlyActive = false) {
    return this.prisma.service.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: { id: 'asc' },
    });
  }

  createService(dto: ServiceDto) {
    return this.prisma.service.create({
      data: { name: dto.name.trim(), price: dto.price, isActive: dto.isActive ?? true },
    });
  }

  updateService(id: number, dto: ServiceDto) {
    return this.prisma.service.update({
      where: { id },
      data: { name: dto.name.trim(), price: dto.price, isActive: dto.isActive ?? true },
    });
  }

  createRoom(dto: RoomDto) {
    return this.prisma.room.create({
      data: { roomTypeId: dto.roomTypeId, roomNumber: dto.roomNumber.trim() },
    });
  }
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('room-types')
  roomTypes() {
    return this.catalog.roomTypes();
  }

  @Get('services')
  services() {
    return this.catalog.services(true);
  }

  @Allow('STAFF')
  @Get('services/all')
  allServices() {
    return this.catalog.services(false);
  }

  @Allow('STAFF')
  @Get('rooms')
  rooms() {
    return this.catalog.rooms();
  }

  @Allow('ADMIN')
  @Post('services')
  createService(@Body() dto: ServiceDto) {
    return this.catalog.createService(dto);
  }

  @Allow('ADMIN')
  @Patch('services/:id')
  updateService(@Param('id', ParseIntPipe) id: number, @Body() dto: ServiceDto) {
    return this.catalog.updateService(id, dto);
  }

  @Allow('ADMIN')
  @Post('rooms')
  createRoom(@Body() dto: RoomDto) {
    return this.catalog.createRoom(dto);
  }
}

@Module({ controllers: [CatalogController], providers: [CatalogService] })
export class CatalogModule {}
