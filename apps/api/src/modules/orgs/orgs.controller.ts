import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CurrentMember,
  CurrentUser,
  Public,
  Roles,
  type OrgMember,
  type SessionUser,
} from '../../core/auth/context';
import { OrgAccessGuard } from '../../core/auth/org-access.guard';
import { CONFIG, type Config } from '../../core/config';
import { uuidParam, ZodPipe } from '../../core/zod-pipe';
import { authThrottle, setSessionCookie } from '../auth/auth.controller';
import {
  acceptInviteSchema,
  createInviteSchema,
  updateMemberSchema,
  type AcceptInviteInput,
  type CreateInviteInput,
  type UpdateMemberInput,
} from './orgs.schemas';
import { OrgsService } from './orgs.service';

@Controller('orgs/:orgId')
@UseGuards(OrgAccessGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  get(@CurrentMember() member: OrgMember) {
    return this.orgs.getOrganization(member);
  }

  @Get('members')
  @Roles('admin')
  members(@CurrentMember() member: OrgMember) {
    return this.orgs.listMembers(member);
  }

  @Patch('members/:userId')
  @Roles('admin')
  updateMember(
    @CurrentMember() member: OrgMember,
    @Param('userId', uuidParam) userId: string,
    @Body(new ZodPipe(updateMemberSchema)) body: UpdateMemberInput,
  ) {
    return this.orgs.updateMember(member, userId, body);
  }

  @Delete('members/:userId')
  @Roles('admin')
  @HttpCode(204)
  async removeMember(
    @CurrentMember() member: OrgMember,
    @Param('userId', uuidParam) userId: string,
  ) {
    await this.orgs.removeMember(member, userId);
  }

  @Get('invites')
  @Roles('admin')
  invites(@CurrentMember() member: OrgMember) {
    return this.orgs.listInvites(member);
  }

  @Post('invites')
  @Roles('admin')
  createInvite(
    @CurrentMember() member: OrgMember,
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(createInviteSchema)) body: CreateInviteInput,
  ) {
    return this.orgs.createInvite(member, user, body);
  }

  @Delete('invites/:inviteId')
  @Roles('admin')
  @HttpCode(204)
  async revokeInvite(
    @CurrentMember() member: OrgMember,
    @Param('inviteId', uuidParam) inviteId: string,
  ) {
    await this.orgs.revokeInvite(member, inviteId);
  }
}

/** Invite links are opened before the person has an account, so these routes are public. */
@Controller('invites/:token')
export class InvitesController {
  constructor(
    private readonly orgs: OrgsService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @Get()
  describe(@Param('token') token: string) {
    return this.orgs.describeInvite(token);
  }

  @Public()
  @authThrottle()
  @Post('accept')
  async accept(
    @Param('token') token: string,
    @Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, orgId } = await this.orgs.acceptInvite(token, body);
    setSessionCookie(res, this.config, session);
    return { user: session.user, orgId };
  }
}
