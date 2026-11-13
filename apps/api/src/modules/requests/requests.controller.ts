import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentMember, type OrgMember } from '../../core/auth/context';
import { OrgAccessGuard } from '../../core/auth/org-access.guard';
import { uuidParam, ZodPipe } from '../../core/zod-pipe';
import {
  decisionSchema,
  listRequestsSchema,
  listTasksSchema,
  resubmitSchema,
  submitRequestSchema,
  type DecisionInput,
  type ListRequestsQuery,
  type ListTasksQuery,
  type ResubmitInput,
  type SubmitRequestInput,
} from './requests.schemas';
import { RequestsService } from './requests.service';

@Controller('orgs/:orgId/requests')
@UseGuards(OrgAccessGuard)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  list(
    @CurrentMember() member: OrgMember,
    @Query(new ZodPipe(listRequestsSchema)) query: ListRequestsQuery,
  ) {
    return this.requests.list(member, query);
  }

  @Post()
  submit(
    @CurrentMember() member: OrgMember,
    @Body(new ZodPipe(submitRequestSchema)) body: SubmitRequestInput,
  ) {
    return this.requests.submit(member, body);
  }

  @Get(':requestId')
  get(@CurrentMember() member: OrgMember, @Param('requestId', uuidParam) requestId: string) {
    return this.requests.get(member, requestId);
  }

  @Post(':requestId/resubmit')
  @HttpCode(200)
  resubmit(
    @CurrentMember() member: OrgMember,
    @Param('requestId', uuidParam) requestId: string,
    @Body(new ZodPipe(resubmitSchema)) body: ResubmitInput,
  ) {
    return this.requests.resubmit(member, requestId, body);
  }

  @Post(':requestId/withdraw')
  @HttpCode(200)
  withdraw(@CurrentMember() member: OrgMember, @Param('requestId', uuidParam) requestId: string) {
    return this.requests.withdraw(member, requestId);
  }
}

@Controller('orgs/:orgId/tasks')
@UseGuards(OrgAccessGuard)
export class TasksController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  inbox(
    @CurrentMember() member: OrgMember,
    @Query(new ZodPipe(listTasksSchema)) query: ListTasksQuery,
  ) {
    return this.requests.inbox(member, query);
  }

  @Post(':taskId/decision')
  @HttpCode(200)
  decide(
    @CurrentMember() member: OrgMember,
    @Param('taskId', uuidParam) taskId: string,
    @Body(new ZodPipe(decisionSchema)) body: DecisionInput,
  ) {
    return this.requests.decide(member, taskId, body);
  }
}
