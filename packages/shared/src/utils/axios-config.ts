/**
 * Centralized Axios Configuration with Retry Logic
 * This configuration is applied globally to all axios requests
 */

import axios from 'axios';
import axiosRetry, { isNetworkError, isRetryableError, isIdempotentRequestError } from 'axios-retry';
import { logger } from './logger';

// Configure axios retry globally
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, retryCount - 1) * 1000;
    return delay;
  },
  retryCondition: (error) => {
    // Retry on network errors and 5xx responses
    const networkError = isNetworkError(error);
    const retryableError = isRetryableError(error);
    const is5xxError = error.response && error.response.status >= 500;
    const idempotentError = isIdempotentRequestError(error);
    
    return networkError || retryableError || is5xxError || idempotentError;
  },
  onRetry: (retryCount, error, requestConfig) => {
    const url = requestConfig.url || requestConfig.baseURL;
    const method = (requestConfig.method || 'GET').toUpperCase();
    const errorMsg = error.response?.status 
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    
    logger.warn(
      `🔄 Retrying ${method} ${url} (attempt ${retryCount}/3) - Error: ${errorMsg}`
    );
  },
  shouldResetTimeout: true,
});

// Export configured axios instance
export { axios };
export default axios;
