import PriorityQueue from 'priorityqueue';
import { BinaryHeap } from 'priorityqueue/lib/cjs/BinaryHeap';
import { Subject } from 'rxjs';
import Auditor from './auditor';
import Server from './server';
import { Job, TaskOperation, Task } from './types';
import { safeCollectionGet } from './util';

export default class TaskManager {

  private server: Server;
  private jobQueue$: Subject<undefined>;
  private priorityQueue: BinaryHeap<number>;
  private cancelled: Set<number>;
  private auditor: Auditor;

  constructor(server: Server) {
    this.server = server;
    this.cancelled = new Set<number>();
    this.auditor = new Auditor(server);
    this.priorityQueue = new PriorityQueue<number>({
      comparator: this.jobCompare.bind(this),
    });
    this.jobQueue$ = new Subject<undefined>();
    this.jobQueue$.subscribe(async () => {
      const jobId = this.priorityQueue.pop();
      this.processJob(jobId);
    });
  }

  get store() { return this.server.store; }

  // ===== JOB QUEUE ============================================================

  private jobCompare(jobId1: number, jobId2: number): number {
    if (this.cancelled.has(jobId1)) return 1;
    else if (this.cancelled.has(jobId2)) return -1;
    else {
      const job1 = safeCollectionGet(this.store.jobs, 'id', jobId1);
      const job2 = safeCollectionGet(this.store.jobs, 'id', jobId2);
      const task1 = job1.task;
      const task2 = job2.task;
      if (task1.dependencyIds.includes(task2.id)) return -1;
      else if (task2?.dependencyIds.includes(task1.id)) return 1;
      else return 0;
    }
  }

  public submitTask(taskIdent: Task | number): Promise<void> {
    const task = (typeof taskIdent === 'number') ?
      safeCollectionGet(this.store.tasks, 'id', taskIdent) :
      taskIdent;
    const { job } = task;
    if (job === undefined) {
      task.dependencies.forEach(depTask => {
        if (depTask.lastCompleted === undefined && depTask.job === undefined) {  // unscheduled
          this.submitTask(depTask);
        }
      });
      const newJob = new Job(this.store, { taskId: task.id });
      this.store.jobs.insert(newJob);
      this.priorityQueue.push(newJob.id);
      this.jobQueue$.next(undefined);
      return newJob.promise;
    } else {
      return job.promise;
    }
  }

  public cancelJob(jobId: number) {
    this.cancelled.add(jobId);
  }

  private async processJob(jobId: number) {
    if (this.cancelled.has(jobId)) {
      this.cancelled.delete(jobId);
    } else {  // pending
      const job = safeCollectionGet(this.store.jobs, 'id', jobId);
      const { task } = job;
      await this.executeTask(task);
      task.lastCompleted = Date.now();
      this.store.tasks.update(task);
      job.fulfill();
      this.store.jobs.findAndRemove({ id: job.id });
    }
  }

  // private async executeTask(task: Task) {
  //   const { document } = task;
  //   if (task.operation === Operation.index) {
  //     document.index = this.indexer.analyze(document);
  //     this.store.documents.update(document);
  //   } else if (task.operation === Operation.audit) {
  //     document.diagnostics = await this.auditor.analyze(document);
  //     this.store.documents.update(document);
  //   }
  // }

  private async executeTask(task: Task) {
    const { document } = task;
    if (task.operation === TaskOperation.audit) {
      document.diagnostics = await this.auditor.analyze(document);
      this.store.documents.update(document);
    }
  }

}
