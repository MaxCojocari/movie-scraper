import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ScraperService } from './scraper/scraper.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.get(ScraperService).startScraping();

  await app.close();
}
bootstrap();
