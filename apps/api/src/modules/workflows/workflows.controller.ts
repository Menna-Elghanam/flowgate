import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentMember, Roles, type OrgMember } from '../../core/auth/context';
import { OrgAccessGuard } from '../../core/auth/org-access.guard';
import { uuidParam, ZodPipe } from '../../core/zod-pipe';
import {
  createWorkflowSchema,
  saveDraftSchema,
  updateWorkflowSchema,
  type CreateWorkflowInput,
  type SaveDraftInput,
  type UpdateWorkflowInput,
} from './workflows.schemas';
import { WorkflowsService } from './workflows.service';

@Controller('orgs/:orgId/workflows')
@UseGuards(OrgAccessGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  /** Published workflows anyone in the organization can submit a request to. */
  @Get('available')
  available(@CurrentMember() member: OrgMember) {
    return this.workflows.available(member);
  }

  @Get()
  @Roles('admin')
  list(@CurrentMember() member: OrgMember) {
    return this.workflows.list(member);
  }

  @Post()
  @Roles('admin')
  create(
    @CurrentMember() member: OrgMember,
    @Body(new ZodPipe(createWorkflowSchema)) body: CreateWorkflowInput,
  ) {
    return this.workflows.create(member, body);
  }

  @Get(':workflowId')
  @Roles('admin')
  get(@CurrentMember() member: OrgMember, @Param('workflowId', uuidParam) workflowId: string) {
    return this.workflows.get(member, workflowId);
  }

  @Patch(':workflowId')
  @Roles('admin')
  update(
    @CurrentMember() member: OrgMember,
    @Param('workflowId', uuidParam) workflowId: string,
    @Body(new ZodPipe(updateWorkflowSchema)) body: UpdateWorkflowInput,
  ) {
    return this.workflows.update(member, workflowId, body);
  }

  @Put(':workflowId/draft')
  @Roles('admin')
  saveDraft(
    @CurrentMember() member: OrgMember,
    @Param('workflowId', uuidParam) workflowId: string,
    @Body(new ZodPipe(saveDraftSchema)) body: SaveDraftInput,
  ) {
    return this.workflows.saveDraft(member, workflowId, body.definition);
  }

  @Delete(':workflowId/draft')
  @Roles('admin')
  discardDraft(
    @CurrentMember() member: OrgMember,
    @Param('workflowId', uuidParam) workflowId: string,
  ) {
    return this.workflows.discardDraft(member, workflowId);
  }

  @Post(':workflowId/publish')
  @Roles('admin')
  publish(@CurrentMember() member: OrgMember, @Param('workflowId', uuidParam) workflowId: string) {
    return this.workflows.publish(member, workflowId);
  }
}
