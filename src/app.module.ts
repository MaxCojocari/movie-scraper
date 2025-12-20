import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ScraperModule } from './scraper/scraper.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [ScraperModule, DatabaseModule],
  controllers: [],
  providers: [AppService],
})
export class AppModule {}
