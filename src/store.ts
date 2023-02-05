import Loki from 'lokijs';
import Server from './server';
import { Job, Task } from './types';
import Document from './types/document';
import Workspace from './types/workspace';

export default class Store {

  private db: Loki;
  private server: Server;

  constructor(server: Server) {
    this.server = server;
    this.db = new Loki('db');

    // ************************************************************************
    // ****** COLLECTIONS *****************************************************

    // ===== DOCUMENTS / WORKSPACES ===============================================

    this.db.addCollection<Document>('documents', {
      unique: ['id', 'uri'],
      indices: ['workspaceId'],
    });

    this.db.addCollection<Workspace>('workspaces', {
      unique: ['id', 'uri'],
    });

    // ===== TASKS / JOBS =========================================================

    this.db.addCollection<Job>('jobs', {
      unique: ['id', 'taskId'],
    });

    this.db.addCollection<Task>('tasks', {
      unique: ['id'],
      indices: ['documentId'],
    });

  }

  // ----- DOCUMENTS / WORKSPACES

  get documents() { return this.db.getCollection<Document>('documents'); }
  get workspaces() { return this.db.getCollection<Workspace>('workspaces'); }

  // ----- TASKS / JOBS

  get jobs() { return this.db.getCollection<Job>('jobs'); }
  get tasks() { return this.db.getCollection<Task>('tasks'); }

}
