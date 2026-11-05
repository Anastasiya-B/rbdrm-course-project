import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from './auth.service';

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
  login(
    @Body()
    body: LoginBody,
  ) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body()
    body: RefreshBody,
  ) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Headers('authorization')
    authorization: string | undefined,
    @Body()
    body: LogoutBody,
  ): Promise<void> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Access token is required');
    }

    const accessToken = authorization.slice('Bearer '.length);

    await this.authService.logout(accessToken, body.refreshToken);
  }
}
