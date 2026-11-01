import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// DATABASE_URL 끝의 ?schema=hw2 를 읽어서 이 과제용 공간만 쓴다.
// 1주차 과제 테이블과 섞이지 않게 하려는 것.
function schemaOf(url: string): string {
  try {
    return new URL(url).searchParams.get('schema') ?? 'public';
  } catch {
    return 'public';
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /** 이 과제가 쓰는 스키마 이름 (직접 쓰는 SQL에 붙인다) */
  readonly schema: string;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL 설정값이 없습니다. backend/.env 또는 Render 설정값을 확인하세요.');
    }
    super({
      adapter: new PrismaPg({ connectionString: url }, { schema: schemaOf(url) }),
      // 원격 DB는 첫 연결(SSL)에 2초 가까이 걸려서 기본 대기 시간을 늘린다.
      transactionOptions: { maxWait: 10_000, timeout: 30_000 },
    });
    this.schema = schemaOf(url);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
