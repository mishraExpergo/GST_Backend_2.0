import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Create a bootstrap admin user from env when the users table is empty. */
  async onModuleInit(): Promise<void> {
    await this.ensureUsersTable();

    const count = await this.userRepo.count();
    if (count > 0) {
      return;
    }

    const username = this.config.get<string>('AUTH_BOOTSTRAP_USERNAME', '').trim();
    const password = this.config.get<string>('AUTH_BOOTSTRAP_PASSWORD', '').trim();
    if (!username || !password) {
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepo.save(
      this.userRepo.create({
        username,
        passwordHash,
      }),
    );
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
    };

    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '1d');

    return {
      access_token: await this.jwtService.signAsync(payload),
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: {
        id: user.id,
        username: user.username,
      },
    };
  }

  async validateUser(username: string, password: string): Promise<User | null> {
    const normalized = username.trim();
    if (!normalized || !password) {
      return null;
    }

    const user = await this.userRepo.findOne({
      where: { username: normalized },
    });
    if (!user) {
      return null;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  /** Ensures users table exists when POSTGRES_SYNC=false. */
  private async ensureUsersTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username character varying NOT NULL UNIQUE,
        "passwordHash" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  }
}
