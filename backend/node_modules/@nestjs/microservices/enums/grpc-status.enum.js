/**
 * @publicApi
 */
export var GrpcStatus;
(function (GrpcStatus) {
    GrpcStatus[GrpcStatus["OK"] = 0] = "OK";
    GrpcStatus[GrpcStatus["CANCELLED"] = 1] = "CANCELLED";
    GrpcStatus[GrpcStatus["UNKNOWN"] = 2] = "UNKNOWN";
    GrpcStatus[GrpcStatus["INVALID_ARGUMENT"] = 3] = "INVALID_ARGUMENT";
    GrpcStatus[GrpcStatus["DEADLINE_EXCEEDED"] = 4] = "DEADLINE_EXCEEDED";
    GrpcStatus[GrpcStatus["NOT_FOUND"] = 5] = "NOT_FOUND";
    GrpcStatus[GrpcStatus["ALREADY_EXISTS"] = 6] = "ALREADY_EXISTS";
    GrpcStatus[GrpcStatus["PERMISSION_DENIED"] = 7] = "PERMISSION_DENIED";
    GrpcStatus[GrpcStatus["RESOURCE_EXHAUSTED"] = 8] = "RESOURCE_EXHAUSTED";
    GrpcStatus[GrpcStatus["FAILED_PRECONDITION"] = 9] = "FAILED_PRECONDITION";
    GrpcStatus[GrpcStatus["ABORTED"] = 10] = "ABORTED";
    GrpcStatus[GrpcStatus["OUT_OF_RANGE"] = 11] = "OUT_OF_RANGE";
    GrpcStatus[GrpcStatus["UNIMPLEMENTED"] = 12] = "UNIMPLEMENTED";
    GrpcStatus[GrpcStatus["INTERNAL"] = 13] = "INTERNAL";
    GrpcStatus[GrpcStatus["UNAVAILABLE"] = 14] = "UNAVAILABLE";
    GrpcStatus[GrpcStatus["DATA_LOSS"] = 15] = "DATA_LOSS";
    GrpcStatus[GrpcStatus["UNAUTHENTICATED"] = 16] = "UNAUTHENTICATED";
})(GrpcStatus || (GrpcStatus = {}));
