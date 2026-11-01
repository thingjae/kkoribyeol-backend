import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { Allow, CurrentUser, type Actor } from '../common/auth.js';
import { generateTempPassword, hashPassword } from '../common/password.js';

class CreateStaffDto {
  @IsEmail({}, { message: '이메일 형식이 아닙니다.' }) email!: string;
  @IsString() @MinLength(1, { message: '이름을 적어 주세요.' }) name!: string;
  @IsIn(['ADMIN', 'STAFF'], { message: '역할은 관리자 또는 일반 직원이어야 합니다.' })
  role!: 'ADMIN' | 'STAFF';
}

class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(['ADMIN', 'STAFF']) role?: 'ADMIN' | 'STAFF';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * 직원 계정은 회원가입이 없다. 관리자가 어드민에서 만든다.
 * 비밀번호를 리셋하면 임시 비밀번호가 나오고, 그 직원은 다음 로그인 때 반드시 바꿔야 한다.
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(staff: {
    id: number;
    email: string;
    name: string;
    role: 'ADMIN' | 'STAFF';
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: Date;
  }) {
    return {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      isActive: staff.isActive,
      mustChangePassword: staff.mustChangePassword,
      createdAt: staff.createdAt,
    };
  }

  async list() {
    const rows = await this.prisma.staff.findMany({ orderBy: { id: 'asc' } });
    return rows.map((row) => this.shape(row));
  }

  async create(dto: CreateStaffDto) {
    const tempPassword = generateTempPassword();
    try {
      const staff = await this.prisma.staff.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          name: dto.name.trim(),
          role: dto.role,
          passwordHash: await hashPassword(tempPassword),
          mustChangePassword: true,
        },
      });
      // 임시 비밀번호는 만든 직후 이 한 번만 보여 준다. DB에는 해시만 남는다.
      return { staff: this.shape(staff), tempPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('이미 쓰고 있는 이메일입니다.');
      }
      throw error;
    }
  }

  async update(actor: Actor, id: number, dto: UpdateStaffDto) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('직원 계정을 찾을 수 없습니다.');

    // 관리자가 자기 계정을 스스로 잠그거나 일반 직원으로 낮추면 아무도 관리할 수 없게 된다.
    if (actor.kind === 'STAFF' && actor.id === id) {
      if (dto.isActive === false) throw new BadRequestException('자기 계정은 멈출 수 없습니다.');
      if (dto.role === 'STAFF') throw new BadRequestException('자기 계정의 역할은 낮출 수 없습니다.');
    }
    if ((dto.isActive === false || dto.role === 'STAFF') && staff.role === 'ADMIN') {
      const admins = await this.prisma.staff.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) {
        throw new BadRequestException('관리자가 한 명뿐입니다. 다른 관리자를 먼저 만들어 주세요.');
      }
    }

    const updated = await this.prisma.staff.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? staff.name,
        role: dto.role ?? staff.role,
        isActive: dto.isActive ?? staff.isActive,
      },
    });
    return this.shape(updated);
  }

  async resetPassword(id: number) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('직원 계정을 찾을 수 없습니다.');

    const tempPassword = generateTempPassword();
    await this.prisma.staff.update({
      where: { id },
      data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
    });
    return { tempPassword };
  }
}

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Allow('ADMIN')
  @Get()
  list() {
    return this.staff.list();
  }

  @Allow('ADMIN')
  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Allow('ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() actor: Actor,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(actor, id, dto);
  }

  @Allow('ADMIN')
  @Post(':id/reset-password')
  resetPassword(@Param('id', ParseIntPipe) id: number) {
    return this.staff.resetPassword(id);
  }
}

@Module({ controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
