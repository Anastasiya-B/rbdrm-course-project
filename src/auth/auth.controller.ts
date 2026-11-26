import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../validation/zod.pipe';
import { loginSchema, logoutSchema, refreshSchema } from '../validation/schemas';
import { RateLimitGuard } from '../redis/rate-limit.guard';

interface LoginBody {
  email: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

interface LogoutBody {
  refreshToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  login(
    @Body(new ZodValidationPipe(loginSchema))
    body: LoginBody,
  ) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshSchema))
    body: RefreshBody,
  ) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Headers('authorization')
    authorization: string | undefined,
    @Body(new ZodValidationPipe(logoutSchema))
    body: LogoutBody,
  ): Promise<void> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Access token is required');
    }

    const accessToken = authorization.slice('Bearer '.length);

    await this.authService.logout(accessToken, body.refreshToken);
  }
}
