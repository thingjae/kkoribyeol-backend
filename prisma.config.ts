import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // 코드 만들기(generate)는 DB 주소 없이도 되게 빈 값을 허용한다.
    // 실제로 DB에 붙는 명령은 DATABASE_URL 이 꼭 있어야 한다.
    url: process.env.DATABASE_URL ?? '',
  },
});
