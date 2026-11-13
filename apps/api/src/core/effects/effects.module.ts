import { Global, Module, type DynamicModule, type Type } from '@nestjs/common';
import { Clock } from '../clock';
import { EffectsRunner } from './effects';
import { UnitOfWork } from './unit-of-work';

@Global()
@Module({})
export class EffectsModule {
  /**
   * The app delivers effects through queues and uses the real clock; the seed script
   * passes a no-op runner and a clock it can set to past dates.
   */
  static forRoot(runner: Type<EffectsRunner>, clock: Type<Clock> = Clock): DynamicModule {
    return {
      module: EffectsModule,
      providers: [
        { provide: EffectsRunner, useClass: runner },
        { provide: Clock, useClass: clock },
        UnitOfWork,
      ],
      exports: [EffectsRunner, UnitOfWork, Clock],
    };
  }
}

export class NoopEffectsRunner extends EffectsRunner {
  async flush(): Promise<void> {}
}
