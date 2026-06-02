import { __decorate } from "tslib";
import { Catch, } from '@nestjs/common';
import { isNumber, isObject } from '@nestjs/common/internal';
import { MESSAGES } from '@nestjs/core/internal';
import { throwError } from 'rxjs';
import { GrpcStatus } from '../enums/grpc-status.enum.js';
import { GrpcException } from './grpc-exception.js';
import { RpcException } from './rpc-exception.js';
/**
 * @publicApi
 */
let GrpcExceptionFilter = class GrpcExceptionFilter {
    catch(exception, host) {
        if (exception instanceof GrpcException) {
            return throwError(() => exception.getError());
        }
        if (exception instanceof RpcException) {
            return throwError(() => this.serializeRpcException(exception));
        }
        return throwError(() => ({
            code: GrpcStatus.UNKNOWN,
            message: MESSAGES.UNKNOWN_EXCEPTION_MESSAGE,
        }));
    }
    serializeRpcException(exception) {
        const error = exception.getError();
        if (isObject(error)) {
            const code = this.getErrorCode(error);
            if (isNumber(code)) {
                return {
                    ...error,
                    code,
                    message: exception.message,
                };
            }
        }
        return {
            code: GrpcStatus.UNKNOWN,
            message: exception.message,
        };
    }
    getErrorCode(error) {
        const { code, status } = error;
        if (isNumber(code)) {
            return code;
        }
        if (isNumber(status)) {
            return status;
        }
    }
};
GrpcExceptionFilter = __decorate([
    Catch()
], GrpcExceptionFilter);
export { GrpcExceptionFilter };
