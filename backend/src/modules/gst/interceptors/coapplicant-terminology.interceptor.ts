import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { renameConsideredInApiPayload } from '../services/gst-terminology.util';

/**
 * Ensures every GST HTTP response renames considered* → coapplicant*
 * in keys and string values (upload rows, Mongo docs, nested objects).
 */
@Injectable()
export class CoapplicantTerminologyInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(map((data) => renameConsideredInApiPayload(data)));
  }
}
