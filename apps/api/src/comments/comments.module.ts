import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [GovernanceModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
