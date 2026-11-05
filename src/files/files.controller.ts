import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';

import { FilesService, type CreateUploadIntentInput } from './files.service';

interface CommitUploadBody {
  fileId: string;
}

@Controller('uploads')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @UseGuards(AuthGuard)
  @Post('intent')
  @HttpCode(200)
  async createIntent(
    @Req()
    request: AuthenticatedRequest,
    @Body()
    body: CreateUploadIntentInput,
  ) {
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authenticated user is required');
    }

    return this.filesService.createUploadIntent(Number(user.sub), body);
  }

  @UseGuards(AuthGuard)
  @Post('commit')
  @HttpCode(200)
  async commit(
    @Req()
    request: AuthenticatedRequest,
    @Body()
    body: CommitUploadBody,
  ) {
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authenticated user is required');
    }

    return this.filesService.commitUpload(Number(user.sub), body.fileId);
  }
}
