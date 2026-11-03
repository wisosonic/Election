import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AuthedRequest } from '../common/types';
import { DelegatesService } from './delegates.service';

@Controller('delegates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DelegatesController {
  constructor(private readonly delegates: DelegatesService) {}

  @Post('invite')
  @Roles('campaign_admin')
  invite(@Req() req: AuthedRequest, @Body() body: { phone: string }) {
    return this.delegates.invite(req.user!.tenantId, body.phone).then((id) => ({ id }));
  }

  @Post('assign')
  @Roles('campaign_admin')
  assign(@Req() req: AuthedRequest, @Body() body: { delegateId: string; roomId: string; role?: string }) {
    return this.delegates.assignToRoom(req.user!.tenantId, body.delegateId, body.roomId, body.role).then((id) => ({ id }));
  }

  @Get('rooms/:roomId/roster')
  @Roles('campaign_admin', 'coordinator')
  roster(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.delegates.rosterForRoom(req.user!.tenantId, roomId);
  }
}
