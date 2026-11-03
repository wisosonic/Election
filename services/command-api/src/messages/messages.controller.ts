import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AuthedRequest } from '../common/types';
import { MessagesService } from './messages.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('messages/broadcast')
  @Roles('campaign_admin', 'coordinator')
  broadcast(@Req() req: AuthedRequest, @Body() body: { roomId?: string; qadaId?: string; body: string }) {
    const scope = body.roomId ? { roomId: body.roomId } : { qadaId: body.qadaId! };
    return this.messages.broadcast(req.user!.tenantId, req.user!.sub, scope, body.body);
  }

  @Get('rooms/:roomId/messages')
  @Roles('campaign_admin', 'coordinator', 'delegate')
  thread(@Req() req: AuthedRequest, @Param('roomId') roomId: string) {
    return this.messages.threadForRoom(req.user!.tenantId, roomId);
  }
}
