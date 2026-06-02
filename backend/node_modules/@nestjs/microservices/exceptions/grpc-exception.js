import { GrpcStatus } from '../enums/grpc-status.enum.js';
/**
 * @publicApi
 */
export class GrpcException extends Error {
    code;
    constructor(message, code = GrpcStatus.UNKNOWN) {
        super(message);
        this.code = code;
    }
    getCode() {
        return this.code;
    }
    getError() {
        return {
            code: this.code,
            message: this.message,
        };
    }
}
export class GrpcCancelledException extends GrpcException {
    constructor(message = 'Cancelled') {
        super(message, GrpcStatus.CANCELLED);
    }
}
export class GrpcUnknownException extends GrpcException {
    constructor(message = 'Unknown') {
        super(message, GrpcStatus.UNKNOWN);
    }
}
export class GrpcInvalidArgumentException extends GrpcException {
    constructor(message = 'Invalid argument') {
        super(message, GrpcStatus.INVALID_ARGUMENT);
    }
}
export class GrpcDeadlineExceededException extends GrpcException {
    constructor(message = 'Deadline exceeded') {
        super(message, GrpcStatus.DEADLINE_EXCEEDED);
    }
}
export class GrpcNotFoundException extends GrpcException {
    constructor(message = 'Not found') {
        super(message, GrpcStatus.NOT_FOUND);
    }
}
export class GrpcAlreadyExistsException extends GrpcException {
    constructor(message = 'Already exists') {
        super(message, GrpcStatus.ALREADY_EXISTS);
    }
}
export class GrpcPermissionDeniedException extends GrpcException {
    constructor(message = 'Permission denied') {
        super(message, GrpcStatus.PERMISSION_DENIED);
    }
}
export class GrpcResourceExhaustedException extends GrpcException {
    constructor(message = 'Resource exhausted') {
        super(message, GrpcStatus.RESOURCE_EXHAUSTED);
    }
}
export class GrpcFailedPreconditionException extends GrpcException {
    constructor(message = 'Failed precondition') {
        super(message, GrpcStatus.FAILED_PRECONDITION);
    }
}
export class GrpcAbortedException extends GrpcException {
    constructor(message = 'Aborted') {
        super(message, GrpcStatus.ABORTED);
    }
}
export class GrpcOutOfRangeException extends GrpcException {
    constructor(message = 'Out of range') {
        super(message, GrpcStatus.OUT_OF_RANGE);
    }
}
export class GrpcUnimplementedException extends GrpcException {
    constructor(message = 'Unimplemented') {
        super(message, GrpcStatus.UNIMPLEMENTED);
    }
}
export class GrpcInternalException extends GrpcException {
    constructor(message = 'Internal') {
        super(message, GrpcStatus.INTERNAL);
    }
}
export class GrpcUnavailableException extends GrpcException {
    constructor(message = 'Unavailable') {
        super(message, GrpcStatus.UNAVAILABLE);
    }
}
export class GrpcDataLossException extends GrpcException {
    constructor(message = 'Data loss') {
        super(message, GrpcStatus.DATA_LOSS);
    }
}
export class GrpcUnauthenticatedException extends GrpcException {
    constructor(message = 'Unauthenticated') {
        super(message, GrpcStatus.UNAUTHENTICATED);
    }
}
