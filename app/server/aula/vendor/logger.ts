// Application adaptation: authentication never writes logs, even in debug mode.
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
