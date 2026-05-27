"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toNumber = void 0;
const toNumber = (value, fallback) => {
    const parsedValue = Number.parseInt(value ?? '', 10);
    return Number.isNaN(parsedValue) ? fallback : parsedValue;
};
exports.toNumber = toNumber;
//# sourceMappingURL=database.config.js.map