import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type Tx } from '../db/db.module';
import { Effects, EffectsRunner } from './effects';

/** Runs work in one transaction, then delivers the effects it collected — only on commit. */
@Injectable()
export class UnitOfWork {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly runner: EffectsRunner,
  ) {}

  async run<T>(work: (tx: Tx, fx: Effects) => Promise<T>): Promise<T> {
    const fx = new Effects();
    const result = await this.db.transaction((tx) => work(tx, fx));
    if (!fx.isEmpty) await this.runner.flush(fx);
    return result;
  }
}
