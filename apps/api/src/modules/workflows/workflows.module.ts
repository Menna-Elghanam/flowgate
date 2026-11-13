import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsRepository } from './workflows.repository';
import { WorkflowsService } from './workflows.service';

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowsRepository],
})
export class WorkflowsModule {}
