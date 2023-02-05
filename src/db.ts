import { promisify } from 'util';
import redis, { RedisClient } from 'redis';
import Logger from './logger';
import config from './config';
import Server from './server';

const log = new Logger('db');

export default class DB {

  private server: Server;
  private redis: RedisClient;
  private hget: Function;

  constructor(server: Server) {
    this.server = server;
    this.redis = redis.createClient({ url: config.redisURL });
    this.hget = promisify(this.redis.hget).bind(this.redis);
    this.redis.on('error', err => {
      log.error(err);
    });
  }

  async getKey(id: string): Promise<string | undefined> {
    const key = await this.hget('nodes/node/key', id);
    return key || undefined;
  }

  async isValidKey(key: string) {
    const id = key.split('.')[2];
    const realKey = await this.hget('nodes/node/key', id);
    return realKey === key;
  }

}
