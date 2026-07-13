import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Public: exchange username/password for a JWT access token. */
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Protected: returns the currently authenticated user from the JWT. */
  @Get('me')
  me(@Req() req: Request & { user?: { userId: string; username: string } }) {
    return req.user;
  }
}
