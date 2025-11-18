"use strict";
/**
 * Centralized Axios Configuration with Retry Logic
 * This configuration is applied globally to all axios requests
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.axios = void 0;
const axios_1 = __importDefault(require("axios"));
exports.axios = axios_1.default;
const axios_retry_1 = __importStar(require("axios-retry"));
const logger_1 = require("./logger");
// Configure axios retry globally
(0, axios_retry_1.default)(axios_1.default, {
    retries: 3,
    retryDelay: (retryCount) => {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, retryCount - 1) * 1000;
        return delay;
    },
    retryCondition: (error) => {
        // Retry on network errors and 5xx responses
        const networkError = (0, axios_retry_1.isNetworkError)(error);
        const retryableError = (0, axios_retry_1.isRetryableError)(error);
        const is5xxError = error.response && error.response.status >= 500;
        const idempotentError = (0, axios_retry_1.isIdempotentRequestError)(error);
        return networkError || retryableError || is5xxError || idempotentError;
    },
    onRetry: (retryCount, error, requestConfig) => {
        const url = requestConfig.url || requestConfig.baseURL;
        const method = (requestConfig.method || 'GET').toUpperCase();
        const errorMsg = error.response?.status
            ? `${error.response.status} ${error.response.statusText}`
            : error.message;
        logger_1.logger.warn(`🔄 Retrying ${method} ${url} (attempt ${retryCount}/3) - Error: ${errorMsg}`);
    },
    shouldResetTimeout: true,
});
exports.default = axios_1.default;
//# sourceMappingURL=axios-config.js.map