import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ScraperService } from './scraper/scraper.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.get(ScraperService).startScraping(5);

  await app.close();
}
bootstrap();
