import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './auth.constants';

/**
 * Marks a route (or controller) as public so the global JwtAuthGuard
 * skips authentication for it.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
