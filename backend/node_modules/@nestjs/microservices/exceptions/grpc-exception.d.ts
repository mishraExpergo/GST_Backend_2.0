import { GrpcStatus } from '../enums/grpc-status.enum.js';
export interface GrpcExceptionBody {
    code: GrpcStatus;
    message: string;
}
/**
 * @publicApi
 */
export declare class GrpcException extends Error {
    private readonly code;
    constructor(message: string, code?: GrpcStatus);
    getCode(): GrpcStatus;
    getError(): GrpcExceptionBody;
}
export declare class GrpcCancelledException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcUnknownException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcInvalidArgumentException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcDeadlineExceededException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcNotFoundException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcAlreadyExistsException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcPermissionDeniedException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcResourceExhaustedException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcFailedPreconditionException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcAbortedException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcOutOfRangeException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcUnimplementedException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcInternalException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcUnavailableException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcDataLossException extends GrpcException {
    constructor(message?: string);
}
export declare class GrpcUnauthenticatedException extends GrpcException {
    constructor(message?: string);
}
