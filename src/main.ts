import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ValidationError } from 'class-validator';
import { AppModule } from './app.module.js';

/** 쌓인 검사 오류 중 첫 번째 메시지를 쉬운 말 한 줄로 돌려준다 */
function firstMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    const constraints = error.constraints;
    if (constraints) return Object.values(constraints)[0];
    if (error.children?.length) {
      const nested = firstMessage(error.children);
      if (nested) return nested;
    }
  }
  return '입력한 내용을 다시 확인해 주세요.';
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 코어 웹과 어드민, 두 주소에서 오는 요청을 받는다.
  const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => new BadRequestException(firstMessage(errors)),
    }),
  );

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, '0.0.0.0');
  console.log(`꼬리별 백엔드가 ${port}번 포트에서 돌고 있어요. 허용 주소: ${origins.join(', ')}`);
}

await bootstrap();
