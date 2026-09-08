import { Module } from '@nestjs/common';
import { DedupModule } from '@/dedup/dedup.module';
import { ProductsService } from './products.service';

@Module({
  imports: [DedupModule],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
