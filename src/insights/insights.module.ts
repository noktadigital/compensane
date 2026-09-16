import { Module } from '@nestjs/common';
import { DealsModule } from '@/deals/deals.module';
import { PriceHistoryModule } from '@/price-history/price-history.module';
import { InsightsController } from './insights.controller';
import { DiagnosticsService } from './diagnostics.service';
import { PriceHistoryQuery } from './price-history.query';

/**
 * Leitura do pipeline: diagnostico e historico de precos.
 * DealsModule entra por causa do MaturityCriteriaService (fases de criterio);
 * PriceHistoryModule, por causa do PriceReferenceService.
 */
@Module({
  imports: [DealsModule, PriceHistoryModule],
  controllers: [InsightsController],
  providers: [DiagnosticsService, PriceHistoryQuery],
  exports: [DiagnosticsService, PriceHistoryQuery],
})
export class InsightsModule {}
