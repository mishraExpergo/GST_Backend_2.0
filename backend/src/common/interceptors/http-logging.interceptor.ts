import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.originalUrl ?? request.url;
    const start = Date.now();
    const clientIp = request.ip || request.headers?.['x-forwarded-for'] || '-';

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const statusCode = response?.statusCode ?? 0;
          const duration = Date.now() - start;
          this.logger.log(
            `${method} ${url} ${statusCode} ${duration}ms - ${clientIp}`,
          );
        },
        error: (err) => {
          const response = context.switchToHttp().getResponse();
          const statusCode = response?.statusCode ?? err?.status ?? 500;
          const duration = Date.now() - start;
          this.logger.error(
            `${method} ${url} ${statusCode} ${duration}ms - ${clientIp}`,
            err?.stack,
          );
        },
      }),
    );
  }
}
