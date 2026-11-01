import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 코어 웹과 어드민이 백엔드 하나를 같이 쓴다.
 * 백엔드는 요청에 담긴 토큰의 kind 값으로 "고객인지 직원인지"를 가린다.
 * 토큰은 로그인할 때 백엔드가 직접 만들어 서명하므로 손댈 수 없다.
 */
export type Actor =
  | { kind: 'GUARDIAN'; id: number; name: string; email: string }
  | {
      kind: 'STAFF';
      id: number;
      name: string;
      email: string;
      role: 'ADMIN' | 'STAFF';
      mustChangePassword: boolean;
    };

export type TokenPayload = { sub: number; kind: 'GUARDIAN' | 'STAFF' };

/** 로그인 없이 쓸 수 있는 주소 */
export const Public = () => SetMetadata('isPublic', true);

/** 누가 쓸 수 있는 주소인지. GUARDIAN=고객, STAFF=직원 전체, ADMIN=관리자만 */
export type Audience = 'GUARDIAN' | 'STAFF' | 'ADMIN';
export const Allow = (...audiences: Audience[]) => SetMetadata('allow', audiences);

/** 임시 비밀번호 상태에서도 열어 두는 주소 (비밀번호 바꾸기) */
export const AllowWhilePasswordReset = () => SetMetadata('allowWhileReset', true);

/** 컨트롤러에서 로그인한 사람을 받는다 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('isPublic', targets)) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }

    // 토큰만 믿지 않고 매번 계정을 다시 읽는다.
    // 관리자가 계정을 멈추면 이미 로그인해 둔 직원도 바로 막히게 하려는 것.
    const actor = await this.loadActor(payload);
    request.actor = actor;

    const allow = this.reflector.getAllAndOverride<Audience[]>('allow', targets);
    if (allow?.length) this.checkAudience(actor, allow);

    if (
      actor.kind === 'STAFF' &&
      actor.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>('allowWhileReset', targets)
    ) {
      throw new ForbiddenException('임시 비밀번호를 쓰고 있습니다. 비밀번호를 먼저 바꿔 주세요.');
    }

    return true;
  }

  private async loadActor(payload: TokenPayload): Promise<Actor> {
    if (payload.kind === 'GUARDIAN') {
      const guardian = await this.prisma.guardian.findUnique({ where: { id: payload.sub } });
      if (!guardian) throw new UnauthorizedException('계정을 찾을 수 없습니다.');
      return { kind: 'GUARDIAN', id: guardian.id, name: guardian.name, email: guardian.email };
    }

    const staff = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!staff) throw new UnauthorizedException('계정을 찾을 수 없습니다.');
    if (!staff.isActive) throw new UnauthorizedException('사용이 멈춘 계정입니다. 관리자에게 문의해 주세요.');
    return {
      kind: 'STAFF',
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      mustChangePassword: staff.mustChangePassword,
    };
  }

  private checkAudience(actor: Actor, allow: Audience[]) {
    const ok = allow.some((audience) => {
      if (audience === 'GUARDIAN') return actor.kind === 'GUARDIAN';
      if (audience === 'STAFF') return actor.kind === 'STAFF';
      return actor.kind === 'STAFF' && actor.role === 'ADMIN';
    });
    if (ok) return;

    if (allow.includes('ADMIN') && actor.kind === 'STAFF') {
      throw new ForbiddenException('관리자만 할 수 있습니다.');
    }
    throw new ForbiddenException('이 화면을 쓸 수 있는 계정이 아닙니다.');
  }
}
