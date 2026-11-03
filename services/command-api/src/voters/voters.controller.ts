import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AuthedRequest } from '../common/types';
import { FamilyImport, RangeImport, VotersService } from './voters.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class VotersController {
  constructor(private readonly voters: VotersService) {}

  @Post('voters/import')
  @Roles('campaign_admin')
  import(@Req() req: AuthedRequest, @Body() body: { ranges: RangeImport[]; families: FamilyImport[] }) {
    return this.voters.importRegistry(req.user!.tenantId, body.ranges, body.families);
  }

  @Get('rooms/:roomId/voters')
  @Roles('campaign_admin', 'coordinator', 'delegate')
  getRoomVoters(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.voters.getRoomVoters(req.user!.tenantId, req.user!, roomId);
  }

  @Get('rooms/:roomId/gotv')
  @Roles('campaign_admin', 'coordinator', 'analyst')
  gotv(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.voters.gotvAggregateForRoom(req.user!.tenantId, roomId);
  }
}
