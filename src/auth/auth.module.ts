import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from '../common/password.js';
import {
  Allow,
  AllowWhilePasswordReset,
  CurrentUser,
  Public,
  type Actor,
} from '../common/auth.js';

class RegisterDto {
  @IsEmail({}, { message: '이메일 형식이 아닙니다.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  password!: string;

  @IsString()
  @MinLength(1, { message: '이름을 적어 주세요.' })
  name!: string;

  @IsString()
  @MinLength(1, { message: '연락처를 적어 주세요.' })
  phone!: string;

  @IsString()
  @MinLength(1, { message: '비상 연락처를 적어 주세요.' })
  emergencyPhone!: string;
}

class LoginDto {
  @IsEmail({}, { message: '이메일 형식이 아닙니다.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: '비밀번호를 적어 주세요.' })
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: '지금 쓰는 비밀번호를 적어 주세요.' })
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: '새 비밀번호는 8자 이상이어야 합니다.' })
  newPassword!: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private sign(sub: number, kind: 'GUARDIAN' | 'STAFF') {
    return this.jwt.signAsync({ sub, kind });
  }

  async registerGuardian(dto: RegisterDto) {
    try {
      const guardian = await this.prisma.guardian.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          passwordHash: await hashPassword(dto.password),
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          emergencyPhone: dto.emergencyPhone.trim(),
        },
      });
      return {
        token: await this.sign(guardian.id, 'GUARDIAN'),
        user: { id: guardian.id, name: guardian.name, email: guardian.email },
      };
    } catch (error) {
      // 이메일 중복은 DB가 막는다(UNIQUE). 거절 이유만 쉬운 말로 바꿔 준다.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('이미 가입된 이메일입니다.');
      }
      throw error;
    }
  }

  async loginGuardian(dto: LoginDto) {
    const guardian = await this.prisma.guardian.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!guardian || !(await verifyPassword(dto.password, guardian.passwordHash))) {
      throw new UnauthorizedException('이메일이나 비밀번호가 맞지 않습니다.');
    }
    return {
      token: await this.sign(guardian.id, 'GUARDIAN'),
      user: { id: guardian.id, name: guardian.name, email: guardian.email },
    };
  }

  async loginStaff(dto: LoginDto) {
    const staff = await this.prisma.staff.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!staff || !(await verifyPassword(dto.password, staff.passwordHash))) {
      throw new UnauthorizedException('이메일이나 비밀번호가 맞지 않습니다.');
    }
    if (!staff.isActive) {
      throw new UnauthorizedException('사용이 멈춘 계정입니다. 관리자에게 문의해 주세요.');
    }
    return {
      token: await this.sign(staff.id, 'STAFF'),
      user: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        mustChangePassword: staff.mustChangePassword,
      },
    };
  }

  async changeStaffPassword(actor: Actor, dto: ChangePasswordDto) {
    if (actor.kind !== 'STAFF') throw new UnauthorizedException('직원 계정만 쓸 수 있습니다.');

    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verifyPassword(dto.currentPassword, staff.passwordHash))) {
      throw new BadRequestException('지금 쓰는 비밀번호가 맞지 않습니다.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('지금 쓰는 비밀번호와 다른 비밀번호를 정해 주세요.');
    }

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        mustChangePassword: false,
      },
    });
    return { ok: true };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.registerGuardian(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.loginGuardian(dto);
  }

  @Public()
  @Post('staff/login')
  staffLogin(@Body() dto: LoginDto) {
    return this.auth.loginStaff(dto);
  }

  @Allow('STAFF')
  @AllowWhilePasswordReset()
  @Post('staff/change-password')
  changePassword(@CurrentUser() actor: Actor, @Body() dto: ChangePasswordDto) {
    return this.auth.changeStaffPassword(actor, dto);
  }

  /** 새로고침했을 때 내가 누구인지 다시 알려 준다 */
  @Get('me')
  @AllowWhilePasswordReset()
  me(@CurrentUser() actor: Actor) {
    return actor;
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
