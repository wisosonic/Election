import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AuthedRequest } from '../common/types';
import { GeoService } from './geo.service';

const READ_ROLES = ['campaign_admin', 'coordinator', 'analyst'] as const;

@Controller('geo')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Post('elections')
  @Roles('campaign_admin')
  createElection(@Req() req: AuthedRequest, @Body() body: { name?: string; electionDate: string }) {
    return this.geo.createElection(req.user!.tenantId, body.name ?? null, body.electionDate).then((id) => ({ id }));
  }

  @Post('mohafazats')
  @Roles('campaign_admin')
  createMohafazat(@Req() req: AuthedRequest, @Body() body: { electionId: string; name: string }) {
    return this.geo.createMohafazat(req.user!.tenantId, body.electionId, body.name).then((id) => ({ id }));
  }

  @Post('qadas')
  @Roles('campaign_admin')
  createQada(@Req() req: AuthedRequest, @Body() body: { mohafazatId: string; name: string }) {
    return this.geo.createQada(req.user!.tenantId, body.mohafazatId, body.name).then((id) => ({ id }));
  }

  @Post('voting-centers')
  @Roles('campaign_admin')
  createVotingCenter(
    @Req() req: AuthedRequest,
    @Body() body: { qadaId: string; name: string; address?: string; geoLat?: number; geoLng?: number },
  ) {
    return this.geo
      .createVotingCenter(req.user!.tenantId, body.qadaId, body.name, body.address, body.geoLat, body.geoLng)
      .then((id) => ({ id }));
  }

  @Post('rooms')
  @Roles('campaign_admin')
  createRoom(@Req() req: AuthedRequest, @Body() body: { votingCenterId: string; label: string }) {
    return this.geo.createRoom(req.user!.tenantId, body.votingCenterId, body.label).then((id) => ({ id }));
  }

  // ---- Reads: cascading admin-form dropdowns + the live rooms overview ----

  @Get('elections')
  @Roles(...READ_ROLES)
  listElections(@Req() req: AuthedRequest) {
    return this.geo.listElections(req.user!.tenantId);
  }

  @Get('elections/:id/mohafazats')
  @Roles(...READ_ROLES)
  listMohafazats(@Req() req: AuthedRequest, @Param('id') electionId: string) {
    return this.geo.listMohafazats(req.user!.tenantId, electionId);
  }

  @Get('mohafazats/:id/qadas')
  @Roles(...READ_ROLES)
  listQadas(@Req() req: AuthedRequest, @Param('id') mohafazatId: string) {
    return this.geo.listQadas(req.user!.tenantId, mohafazatId);
  }

  @Get('qadas/:id/voting-centers')
  @Roles(...READ_ROLES)
  listVotingCenters(@Req() req: AuthedRequest, @Param('id') qadaId: string) {
    return this.geo.listVotingCenters(req.user!.tenantId, qadaId);
  }

  @Get('voting-centers/:id/rooms')
  @Roles(...READ_ROLES)
  listRoomsForCenter(@Req() req: AuthedRequest, @Param('id') votingCenterId: string) {
    return this.geo.listRoomsForCenter(req.user!.tenantId, votingCenterId);
  }

  @Get('rooms')
  @Roles(...READ_ROLES)
  listAllRooms(@Req() req: AuthedRequest) {
    return this.geo.listAllRooms(req.user!.tenantId);
  }
}
