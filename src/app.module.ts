import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ScraperModule } from './scraper/scraper.module';

@Module({
  imports: [ScraperModule],
  controllers: [],
  providers: [AppService],
})
export class AppModule {}
