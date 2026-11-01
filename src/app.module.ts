import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule, PrismaService } from './prisma/prisma.service.js';
import { AuthGuard, Public } from './common/auth.js';
import { AuthModule } from './auth/auth.module.js';
import { PeopleModule } from './people/people.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ReservationsModule } from './reservations/reservations.module.js';
import { StaffModule } from './staff/staff.module.js';
import { todayKst } from './common/kst.js';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async health() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
        schema: this.prisma.schema,
        tookMs: Date.now() - startedAt,
        today: todayKst(),
      };
    } catch (error) {
      return { status: 'error', db: 'disconnected', message: String(error).slice(0, 200) };
    }
  }

  @Public()
  @Get()
  root() {
    return { service: '꼬리별 반려동물 호텔 백엔드', health: '/health' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET 설정값이 없습니다.');
        return { secret, signOptions: { expiresIn: '7d' } };
      },
    }),
    PrismaModule,
    AuthModule,
    PeopleModule,
    CatalogModule,
    ReservationsModule,
    StaffModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
