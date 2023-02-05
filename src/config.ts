import { Config, LogMode } from './types';

let conf: Config;

const DEFAULTS: Config = {
  enable: true,
  logMode: 'console',
  projectRootPatterns: ['.git'],
  redisURL: undefined,
};

export default {

  load(config: any) {
    conf = { ...DEFAULTS, ...config };
  },

  get projectRootPatterns(): string[] {
    return conf.projectRootPatterns;
  },

  get logMode(): LogMode {
    return conf.logMode;
  },

  get redisURL(): string | undefined {
    return conf.redisURL;
  },

};
