import { Module } from '@nestjs/common';
import { EngineModule } from '../../engine/engine.module';
import { RequestsController, TasksController } from './requests.controller';
import { RequestsRepository } from './requests.repository';
import { RequestsService } from './requests.service';

@Module({
  imports: [EngineModule],
  controllers: [RequestsController, TasksController],
  providers: [RequestsService, RequestsRepository],
})
export class RequestsModule {}
