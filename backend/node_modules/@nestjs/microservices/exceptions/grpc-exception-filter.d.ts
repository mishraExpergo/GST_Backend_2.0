import { type ArgumentsHost, type RpcExceptionFilter } from '@nestjs/common';
import { Observable } from 'rxjs';
import { type GrpcExceptionBody } from './grpc-exception.js';
/**
 * @publicApi
 */
export declare class GrpcExceptionFilter implements RpcExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): Observable<GrpcExceptionBody>;
    private serializeRpcException;
    private getErrorCode;
}
