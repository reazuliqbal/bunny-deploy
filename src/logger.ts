import { info, warning, debug as coreDebug } from '@actions/core';

export type LogLevel = 'info' | 'debug';

export interface Logger {
  info: (message: string) => void;
  warning: (message: string) => void;
  debug: (message: string) => void;
}

export const createLogger = (level: LogLevel): Logger => {
  const isDebug = level === 'debug';
  return {
    info: (message: string) => info(message),
    warning: (message: string) => warning(message),
    debug: (message: string) => {
      if (isDebug) coreDebug(message);
    },
  };
};

export const silentLogger: Logger = {
  info: () => undefined,
  warning: () => undefined,
  debug: () => undefined,
};
