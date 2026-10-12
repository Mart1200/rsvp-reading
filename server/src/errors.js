/**
 * Error that is turned into a JSON error response by the app's error handler
 */
export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} code - Machine-readable error code, e.g. "VALIDATION"
   * @param {string} message - Human-readable message
   * @param {Object} [options]
   * @param {Record<string, string>} [options.headers] - Extra response headers, e.g. Retry-After
   */
  constructor(status, code, message, { headers = {} } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * Build the uniform error response body
 * @param {string} code - Machine-readable error code
 * @param {string} message - Human-readable message
 * @returns {{error: {code: string, message: string}}}
 */
export function errorBody(code, message) {
  return { error: { code, message } };
}
