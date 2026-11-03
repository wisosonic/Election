import { Module } from '@nestjs/common';
import { dbProvider } from './db.provider';
import { pubsubProvider } from './pubsub.provider';
import { jwtVerifierProvider } from './common/jwt-verifier.provider';
import { GeoService } from './geo/geo.service';
import { GeoController } from './geo/geo.controller';
import { DelegatesService } from './delegates/delegates.service';
import { DelegatesController } from './delegates/delegates.controller';
import { VotersService } from './voters/voters.service';
import { VotersController } from './voters/voters.controller';
import { ResultsService } from './results/results.service';
import { ResultsController } from './results/results.controller';
import { BROADCAST_PUBLISHER } from './messages/broadcast-publisher.port';
import { MqttBroadcastPublisher } from './messages/mqtt-broadcast-publisher';
import { MessagesService } from './messages/messages.service';
import { MessagesController } from './messages/messages.controller';
import { AuditController } from './audit/audit.controller';

@Module({
  controllers: [GeoController, DelegatesController, VotersController, ResultsController, MessagesController, AuditController],
  providers: [
    dbProvider,
    pubsubProvider,
    jwtVerifierProvider,
    GeoService,
    DelegatesService,
    VotersService,
    ResultsService,
    { provide: BROADCAST_PUBLISHER, useClass: MqttBroadcastPublisher },
    MessagesService,
  ],
})
export class AppModule {}
