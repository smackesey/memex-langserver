#!/usr/bin/env node

import { Observable, of, Subject } from 'rxjs';
import { switchMap } from 'rxjs/operators';

// const { Observable } = require('rxjs');
// const ops = require('rxjs/operators');

of(1, 2, 3).pipe(
  switchMap(n => (
    new Observable(obs => {
      setTimeout(() => {
        obs.next(n);
        obs.complete();
      }, 500);
      return () => console.log(`close ${n}`);
    })),
  ),
).subscribe(n => console.log(`finished ${n}`));

const subject = new Subject<number>();

of(1, 2, 3).subscribe(subject);
