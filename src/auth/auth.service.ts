import { Injectable, UnauthorizedException } from '@nestjs/common';

import { randomUUID } from 'node:crypto';

import AppDataSource from '../data-source';

import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type UserRole,
} from './auth.tokens';

import { verifyPassword } from './password';

import { getAuthConfig } from './auth.config';

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  role: UserRole;
}

interface RefreshTokenRow {
  id: string;
  token_hash: string;
  family_id: string;
  user_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
  role: UserRole;
}

interface LogoutRefreshRow {
  family_id: string;
  user_id: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private async ensureDataSource(): Promise<void> {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    await this.ensureDataSource();

    const rows = (await AppDataSource.query(
      `
          SELECT
            id,
            email,
            password_hash,
            role
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
      [input.email],
    )) as UserRow[];

    const user = rows[0];

    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const validPassword = await verifyPassword(
      input.password,
      user.password_hash,
    );

    if (!validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const familyId = randomUUID();

    return this.issueTokenPair(Number(user.id), user.role, familyId);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    await this.ensureDataSource();

    const tokenHash = hashRefreshToken(refreshToken);

    const queryRunner = AppDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const rows = (await queryRunner.query(
        `
            SELECT
              rt.id,
              rt.token_hash,
              rt.family_id,
              rt.user_id,
              rt.used_at,
              rt.revoked_at,
              rt.expires_at,
              u.role
            FROM refresh_tokens rt
            JOIN users u
              ON u.id = rt.user_id
            WHERE rt.token_hash = $1
            FOR UPDATE
          `,
        [tokenHash],
      )) as RefreshTokenRow[];

      const current = rows[0];

      if (!current) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const now = new Date();

      if (current.revoked_at || current.expires_at <= now) {
        throw new UnauthorizedException('Refresh token is not active');
      }

      if (current.used_at) {
        await queryRunner.query(
          `
            UPDATE refresh_tokens
            SET revoked_at = COALESCE(
              revoked_at,
              now()
            )
            WHERE family_id = $1
          `,
          [current.family_id],
        );

        await queryRunner.commitTransaction();

        console.warn(`refresh-token-reuse family_id=${current.family_id}`);

        throw new UnauthorizedException('Refresh token reuse detected');
      }

      await queryRunner.query(
        `
          UPDATE refresh_tokens
          SET used_at = now()
          WHERE id = $1
        `,
        [current.id],
      );

      const newRefreshToken = createRefreshToken();

      const newTokenHash = hashRefreshToken(newRefreshToken);

      const access = signAccessToken(
        Number(current.user_id),
        current.role,
        current.family_id,
      );

      const config = getAuthConfig();

      const expiresAt = new Date(
        Date.now() + config.refreshTokenTtlSeconds * 1000,
      );

      await queryRunner.query(
        `
          INSERT INTO refresh_tokens (
            token_hash,
            family_id,
            user_id,
            expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4
          )
        `,
        [newTokenHash, current.family_id, current.user_id, expiresAt],
      );

      await queryRunner.commitTransaction();

      return {
        accessToken: access.token,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async logout(accessToken: string, refreshToken: string): Promise<void> {
    await this.ensureDataSource();

    let payload;

    try {
      payload = verifyAccessToken(accessToken);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const refreshHash = hashRefreshToken(refreshToken);

    const queryRunner = AppDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const rows = (await queryRunner.query(
        `
            SELECT
              family_id,
              user_id
            FROM refresh_tokens
            WHERE token_hash = $1
            LIMIT 1
            FOR UPDATE
          `,
        [refreshHash],
      )) as LogoutRefreshRow[];

      const refresh = rows[0];

      if (!refresh) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (
        refresh.family_id !== payload.familyId ||
        Number(refresh.user_id) !== Number(payload.sub)
      ) {
        throw new UnauthorizedException('Token pair mismatch');
      }

      await queryRunner.query(
        `
          UPDATE refresh_tokens
          SET revoked_at = COALESCE(
            revoked_at,
            now()
          )
          WHERE family_id = $1
        `,
        [refresh.family_id],
      );

      const exp = Number(payload.exp ?? 0);

      const expiresAt = new Date(exp * 1000);

      if (expiresAt.getTime() > Date.now()) {
        await queryRunner.query(
          `
            INSERT INTO access_token_denylist (
              jti,
              expires_at
            )
            VALUES ($1, $2)
            ON CONFLICT (jti)
            DO UPDATE SET
              expires_at =
                EXCLUDED.expires_at
          `,
          [payload.jti, expiresAt],
        );
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async issueTokenPair(
    userId: number,
    role: UserRole,
    familyId: string,
  ): Promise<AuthResponse> {
    const refreshToken = createRefreshToken();

    const tokenHash = hashRefreshToken(refreshToken);

    const access = signAccessToken(userId, role, familyId);

    const config = getAuthConfig();

    const expiresAt = new Date(
      Date.now() + config.refreshTokenTtlSeconds * 1000,
    );

    await AppDataSource.query(
      `
        INSERT INTO refresh_tokens (
          token_hash,
          family_id,
          user_id,
          expires_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4
        )
      `,
      [tokenHash, familyId, userId, expiresAt],
    );

    return {
      accessToken: access.token,
      refreshToken,
    };
  }
}
