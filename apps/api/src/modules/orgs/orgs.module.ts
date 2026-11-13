import { Module } from '@nestjs/common';
import { EngineModule } from '../../engine/engine.module';
import { AuthModule } from '../auth/auth.module';
import { InvitesController, OrgsController } from './orgs.controller';
import { OrgsRepository } from './orgs.repository';
import { OrgsService } from './orgs.service';

@Module({
  imports: [AuthModule, EngineModule],
  controllers: [OrgsController, InvitesController],
  providers: [OrgsService, OrgsRepository],
})
export class OrgsModule {}
