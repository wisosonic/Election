import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AuthedRequest } from '../common/types';
import { ResultsService } from './results.service';

@Controller('rooms/:roomId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('campaign_admin', 'coordinator', 'analyst')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('turnout')
  turnout(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.results.turnoutForRoom(req.user!.tenantId, roomId);
  }

  @Get('tallies')
  tallies(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.results.talliesForRoom(req.user!.tenantId, roomId);
  }

  @Get('irregularities')
  irregularities(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.results.irregularitiesForRoom(req.user!.tenantId, roomId);
  }
}
