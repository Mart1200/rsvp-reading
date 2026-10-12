/**
 * Error that is turned into a JSON error response by the app's error handler
 */
export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} code - Machine-readable error code, e.g. "VALIDATION"
   * @param {string} message - Human-readable message
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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
