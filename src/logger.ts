import fs from 'fs';
import { Connection } from 'vscode-languageserver';
import { Subject } from 'rxjs';
import { LogMode } from './types';

type LogMessage = {
  level: 'log' | 'info' | 'warn' | 'error',
  message: string
};

let connection: Connection;
let logFile: number;
const queue$ = new Subject<LogMessage>();

export default class Logger {

  public static setup(conn: Connection, mode: LogMode) {
    connection = conn;
    if (typeof mode === 'object') {
      logFile = fs.openSync(mode.path, 'a');
    }
    queue$.subscribe(({ level, message }) => {
      if (mode === 'console') {
        connection.console[level](message);
      } else {
        fs.appendFile(logFile, `${message}\n`, err => {
          if (err) throw err;
        });
      }
    });
  }

  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  private getMessage(message: string) {
    const timestamp = new Date().toTimeString().slice(0, 8);
    return `[${timestamp}] ${this.name}: ${message}`;
  }

  log(msg: string) {
    queue$.next({ level: 'log', message: this.getMessage(msg) });
  }

  info(msg: string) {
    queue$.next({ level: 'info', message: this.getMessage(msg) });
  }

  warn(msg: string) {
    queue$.next({ level: 'warn', message: this.getMessage(msg) });
  }

  error(msg: string) {
    queue$.next({ level: 'error', message: this.getMessage(msg) });
  }

}
